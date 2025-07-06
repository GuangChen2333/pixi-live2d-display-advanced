import { config } from '@/config'
import type { ExpressionManager } from '@/cubism-common/ExpressionManager'
import type { ModelSettings } from '@/cubism-common/ModelSettings'
import { MotionPriority, MotionState } from '@/cubism-common/MotionState'
import { SoundManager, VOLUME } from '@/cubism-common/SoundManager'
import { logger } from '@/utils'
import { utils } from '@pixi/core'
import type { JSONObject, Mutable } from '@/types/helpers'
import type { InternalModel } from '@/cubism-common/InternalModel'

export interface MotionManagerOptions {
  /**
   * How to preload the motions.
   * @default {@link MotionPreloadStrategy.NONE}
   */
  motionPreload?: MotionPreloadStrategy

  /**
   * Specifies the idle motion group.
   * @default "idle" in Cubism 2 and "Idle" in Cubism 4.
   */
  idleMotionGroup?: string
}

/**
 * Indicates how the motions will be preloaded.
 */
export enum MotionPreloadStrategy {
  /** Preload all the motions. */
  ALL = 'ALL',

  /** Preload only the idle motions. */
  IDLE = 'IDLE',

  /** No preload. */
  NONE = 'NONE'
}

/**
 * Handles the motion playback for Live2D models.
 * Responsible for loading, playing, and managing motion states and audio.
 * @emits {@link MotionManagerEvents}
 */
export abstract class MotionManager<
  Motion = unknown,
  MotionSpec = unknown
> extends utils.EventEmitter {
  /**
   * Tag for logging.
   * @type {string}
   */
  tag: string

  // noinspection JSValidateJSDoc
  /**
   * Motion definitions copied from ModelSettings.
   * @type {Partial<Record<string, MotionSpec[]>>}
   * @abstract
   */
  abstract readonly definitions: Partial<Record<string, MotionSpec[]>>

  /**
   * Motion groups with specific internal usages. Includes at least the 'idle' field.
   * @type {{ idle: string }}
   * @abstract
   */
  abstract readonly groups: { idle: string }

  /**
   * Indicates the content type of the motion files, varies in different Cubism versions.
   * Used as `xhr.responseType`.
   * @type {'json' | 'arraybuffer'}
   * @abstract
   */
  abstract readonly motionDataType: 'json' | 'arraybuffer'

  /**
   * Expression manager for handling model expressions.
   * Can be undefined if the settings define no expression.
   * @type {ExpressionManager | undefined}
   * @abstract
   */
  abstract expressionManager?: ExpressionManager

  /**
   * The ModelSettings reference.
   * @type {ModelSettings}
   */
  readonly settings: ModelSettings

  /**
   * The Motions. The structure is the same as {@link definitions}, initially each group contains
   * an empty array, which means all motions will be `undefined`. When a Motion has been loaded,
   * it'll fill the place in which it should be; when it fails to load, the place will be filled
   * with `null`.
   * @type {Partial<Record<string, (Motion | undefined | null)[]>>}
   */
  motionGroups: Partial<Record<string, (Motion | undefined | null)[]>> = {}

  /**
   * Maintains the state of this MotionManager.
   * @type {MotionState}
   */
  state: MotionState = new MotionState()

  /**
   * Audio element of the current motion if a sound file is defined with it.
   * @type {HTMLAudioElement | undefined}
   */
  currentAudio?: HTMLAudioElement

  /**
   * Analyzer element for the current sound being played.
   * @type {AnalyserNode | undefined}
   */
  currentAnalyzer?: AnalyserNode

  /**
   * Context element for the current sound being played.
   * @type {AudioContext | undefined}
   */
  currentContext?: AudioContext

  /**
   * Flags whether there is a motion currently playing.
   * @type {boolean}
   */
  playing: boolean = false

  /**
   * Flags whether the instance has been destroyed.
   * @type {boolean}
   */
  destroyed: boolean = false

  /**
   * Reference to the parent InternalModel.
   * @type {InternalModel}
   */
  parent: InternalModel

  /**
   * Constructor for MotionManager.
   * @param parent - The parent InternalModel.
   */
  protected constructor(parent: InternalModel) {
    super()
    this.settings = parent.settings
    this.tag = `MotionManager(${this.settings.name})`
    this.state.tag = this.tag
    this.parent = parent
  }

  /**
   * Should be called in the constructor of derived class to initialize options and setup motions.
   * @param options - Initialization options for the manager.
   */
  protected init(options?: MotionManagerOptions) {
    if (options?.idleMotionGroup) {
      this.groups.idle = options.idleMotionGroup
    }

    this.setupMotions(options)
    this.stopAllMotions()
  }

  /**
   * Sets up motions from the definitions, and preloads them according to the preload strategy.
   * @param options - Options controlling which motions to preload.
   */
  protected setupMotions(options?: MotionManagerOptions): void {
    for (const group of Object.keys(this.definitions)) {
      // init with the same structure of definitions
      this.motionGroups[group] = []
    }

    // preload motions

    let groups

    switch (options?.motionPreload) {
      case MotionPreloadStrategy.NONE:
        return

      case MotionPreloadStrategy.ALL:
        groups = Object.keys(this.definitions)
        break

      case MotionPreloadStrategy.IDLE:
      default:
        groups = [this.groups.idle]
        break
    }

    for (const group of groups) {
      if (this.definitions[group]) {
        for (let i = 0; i < this.definitions[group]!.length; i++) {
          this.loadMotion(group, i).then()
        }
      }
    }
  }

  /**
   * Loads a Motion in a motion group. Errors in this method will not be thrown,
   * but be emitted with a "motionLoadError" event.
   * @param group - The motion group.
   * @param index - Index in the motion group.
   * @return Promise that resolves with the Motion, or with undefined if it can't be loaded.
   * @emits {@link MotionManagerEvents.motionLoaded}
   * @emits {@link MotionManagerEvents.motionLoadError}
   */
  async loadMotion(group: string, index: number): Promise<Motion | undefined> {
    if (!this.definitions[group]?.[index]) {
      logger.warn(this.tag, `Undefined motion at "${group}"[${index}]`)
      return undefined
    }

    if (this.motionGroups[group]![index] === null) {
      logger.warn(
        this.tag,
        `Cannot start motion at "${group}"[${index}] because it's already failed in loading.`
      )
      return undefined
    }

    if (this.motionGroups[group]![index]) {
      return this.motionGroups[group]![index]!
    }

    const motion = await this._loadMotion(group, index)

    if (this.destroyed) {
      return
    }

    this.motionGroups[group]![index] = motion ?? null

    return motion
  }

  /**
   * Loads the Motion. Will be implemented by Live2DFactory in order to avoid circular dependency.
   * @ignore
   */
  private _loadMotion(_group: string, _index: number): Promise<Motion | undefined> {
    throw new Error('Not implemented.')
  }

  /**
   * Initializes audio playback and sets up audio analysis for lipsync.
   * @param audio - The HTMLAudioElement to initialize.
   * @param volume - The playback volume (0-1).
   */
  initializeAudio(audio: HTMLAudioElement, volume: number) {
    this.currentAudio = audio!
    SoundManager.volume = volume

    this.currentContext = SoundManager.addContext(this.currentAudio)

    this.currentAnalyzer = SoundManager.addAnalyzer(this.currentAudio, this.currentContext)
  }

  /**
   * Only play sound with lip sync.
   * @param sound - The audio url or base64 content.
   * @param volume - Volume of the sound (0-1).
   * @param expression - Expression to apply while playing sound.
   * @param resetExpression - Whether to reset the expression before and after playing sound (default: true).
   * @param crossOrigin - Cross origin setting.
   * @param onFinish - Callback when playback finishes.
   * @param onError - Callback when playback errors.
   * @returns Promise that resolves with true if the sound is playing, false otherwise.
   */
  async speak(
    sound: string,
    {
      volume = VOLUME,
      expression,
      resetExpression = true,
      crossOrigin,
      onFinish,
      onError
    }: {
      volume?: number
      expression?: number | string
      resetExpression?: boolean
      crossOrigin?: string
      onFinish?: () => void
      onError?: (e: Error) => void
    } = {}
  ): Promise<boolean> {
    if (!config.sound) {
      return false
    }

    let audio: HTMLAudioElement | undefined

    if (this.currentAudio) {
      if (!this.currentAudio.ended) {
        return false
      }
    }
    let soundURL: string | undefined
    const isBase64Content = sound && sound.startsWith('data:')

    if (sound && !isBase64Content) {
      const A = document.createElement('a')
      A.href = sound
      sound = A.href // This should be the absolute url
      soundURL = sound
    } else {
      soundURL = 'data:audio/' // Dummy url for base64
    }
    const file: string | undefined = sound
    if (file) {
      try {
        // start to load the audio
        audio = SoundManager.add(
          file,
          (that = this) => {
            logger.warn(this.tag, 'Audio finished playing')
            onFinish?.()
            if (resetExpression && expression && that.expressionManager) {
              that.expressionManager.resetExpression()
            }
            that.currentAudio = undefined
          }, // reset expression when audio is done
          (e, that = this) => {
            logger.error(this.tag, 'Error during audio playback:', e)
            onError?.(e)
            if (resetExpression && expression && that.expressionManager) {
              that.expressionManager.resetExpression()
            }
            that.currentAudio = undefined
          }, // on error
          crossOrigin
        )

        this.initializeAudio(audio, volume)
      } catch (e) {
        logger.warn(this.tag, 'Failed to create audio', soundURL, e)
        return false
      }
    }

    if (audio) {
      let playSuccess = true
      const readyToPlay = SoundManager.play(audio).catch((e) => {
        logger.warn(this.tag, 'Failed to play audio', audio!.src, e)
        playSuccess = false
      })

      if (config.motionSync) {
        // wait until the audio is ready
        await readyToPlay

        if (!playSuccess) {
          return false
        }
      }
    }

    if (this.state.shouldOverrideExpression()) {
      if (this.expressionManager) this.expressionManager.resetExpression()
    }
    if (expression && this.expressionManager) {
      await this.expressionManager.setExpression(expression)
    }

    this.playing = true

    return true
  }

  /**
   * Starts a motion with the given priority.
   * @param group - The motion group.
   * @param index - Index in the motion group.
   * @param priority - The priority to be applied. Default: NORMAL (2).
   * @param sound - The audio url or base64 content.
   * @param volume - Volume of the sound (0-1).
   * @param expression - Expression to apply while playing sound.
   * @param resetExpression - Whether to reset the expression before and after playing sound (default: true).
   * @param crossOrigin - Cross origin setting.
   * @param onFinish - Callback when playback finishes.
   * @param onError - Callback when playback errors.
   * @return Promise that resolves with true if the motion is successfully started, false otherwise.
   */
  async startMotion(
    group: string,
    index: number,
    priority = MotionPriority.NORMAL,
    {
      sound = undefined,
      volume = VOLUME,
      expression = undefined,
      resetExpression = true,
      crossOrigin,
      onFinish,
      onError
    }: {
      sound?: string
      volume?: number
      expression?: number | string
      resetExpression?: boolean
      crossOrigin?: string
      onFinish?: () => void
      onError?: (e: Error) => void
    } = {}
  ): Promise<boolean> {
    if (!this.state.reserve(group, index, priority)) {
      return false
    }
    // Does not start a new motion if audio is still playing
    if (this.currentAudio) {
      if (!this.currentAudio.ended && priority != MotionPriority.FORCE) {
        return false
      }
    }

    const definition = this.definitions[group]?.[index]

    if (!definition) {
      return false
    }

    if (this.currentAudio) {
      // TODO: reuse the audio?
      SoundManager.dispose(this.currentAudio)
    }

    let audio: HTMLAudioElement | undefined

    let soundURL: string | undefined
    const isBase64Content = sound && sound.startsWith('data:')

    if (sound && !isBase64Content) {
      const A = document.createElement('a')
      A.href = sound
      sound = A.href // This should be the absolute url
      soundURL = sound
    } else {
      soundURL = this.getSoundFile(definition)
      if (soundURL) {
        soundURL = this.settings.resolveURL(soundURL)
      }
    }
    const file: string | undefined = soundURL

    if (file) {
      try {
        // start to load the audio
        audio = SoundManager.add(
          file,
          (that = this) => {
            onFinish?.()
            if (resetExpression && expression && that.expressionManager) {
              that.expressionManager.resetExpression()
            }
            that.currentAudio = undefined
          }, // reset expression when audio is done
          (e, that = this) => {
            logger.error(this.tag, 'Error during audio playback:', e)
            onError?.(e)
            if (resetExpression && expression && that.expressionManager) {
              that.expressionManager.resetExpression()
            }
            that.currentAudio = undefined
          }, // on error
          crossOrigin
        )

        this.initializeAudio(audio, volume)
      } catch (e) {
        logger.warn(this.tag, 'Failed to create audio', soundURL, e)
      }
    }

    const motion = await this.loadMotion(group, index)

    if (audio) {
      const readyToPlay = SoundManager.play(audio).catch((e) =>
        logger.warn(this.tag, 'Failed to play audio', audio!.src, e)
      )

      if (config.motionSync) {
        // wait until the audio is ready
        await readyToPlay
      }
    }

    if (!this.state.start(motion, group, index, priority)) {
      if (audio) {
        SoundManager.dispose(audio)
        this.currentAudio = undefined
      }

      return false
    }

    if (this.state.shouldOverrideExpression()) {
      if (this.expressionManager) this.expressionManager.resetExpression()
    }

    logger.log(this.tag, 'Start motion:', this.getMotionName(definition))

    this.emit('motionStart', group, index, audio)

    if (expression && this.expressionManager && this.state.shouldOverrideExpression()) {
      await this.expressionManager.setExpression(expression)
    }

    this.playing = true

    this._startMotion(motion!)

    return true
  }

  /**
   * Starts a random Motion as given priority.
   * @param group - The motion group.
   * @param priority - The priority to be applied. Default: IDLE (1).
   * @param sound - The audio url or base64 content.
   * @param volume - Volume of the sound (0-1).
   * @param expression - Expression to apply while playing sound.
   * @param resetExpression - Whether to reset the expression before and after playing sound (default: true).
   * @param crossOrigin - Cross origin setting.
   * @param onFinish - Callback when playback finishes.
   * @param onError - Callback when playback errors.
   * @return Promise that resolves with true if the motion is successfully started, false otherwise.
   */
  async startRandomMotion(
    group: string,
    priority?: MotionPriority,
    {
      sound,
      volume = VOLUME,
      expression,
      resetExpression = true,
      crossOrigin,
      onFinish,
      onError
    }: {
      sound?: string
      volume?: number
      expression?: number | string
      resetExpression?: boolean
      crossOrigin?: string
      onFinish?: () => void
      onError?: (e: Error) => void
    } = {}
  ): Promise<boolean> {
    const groupDefs = this.definitions[group]

    if (groupDefs?.length) {
      const availableIndices: number[] = []

      for (let i = 0; i < groupDefs!.length; i++) {
        if (this.motionGroups[group]![i] !== null && !this.state.isActive(group, i)) {
          availableIndices.push(i)
        }
      }

      if (availableIndices.length) {
        const index = availableIndices[Math.floor(Math.random() * availableIndices.length)]!

        return this.startMotion(group, index, priority, {
          sound: sound,
          volume: volume,
          expression: expression,
          resetExpression: resetExpression,
          crossOrigin: crossOrigin,
          onFinish: onFinish,
          onError: onError
        })
      }
    }

    return false
  }

  /**
   * Stops current audio playback and lipsync.
   */
  stopSpeaking(): void {
    if (this.currentAudio) {
      SoundManager.dispose(this.currentAudio)
      this.currentAudio = undefined
    }
  }

  /**
   * Stops all playing motions as well as the sound.
   */
  stopAllMotions(): void {
    this._stopAllMotions()

    this.state.reset()

    this.stopSpeaking()
  }

  /**
   * Updates parameters of the core model.
   * @param model - The core model.
   * @param now - Current time in milliseconds.
   * @return True if the parameters have been actually updated.
   */
  update(model: object, now: DOMHighResTimeStamp): boolean {
    if (this.isFinished()) {
      if (this.playing) {
        this.playing = false
        this.emit('motionFinish')
      }

      if (this.state.shouldOverrideExpression()) {
        this.expressionManager?.restoreExpression()
      }

      this.state.complete()

      if (this.state.shouldRequestIdleMotion()) {
        // noinspection JSIgnoredPromiseFromCall
        this.startRandomMotion(this.groups.idle, MotionPriority.IDLE)
      }
    }

    return this.updateParameters(model, now)
  }

  /**
   * Move the mouth for lipsync.
   * @returns The current lipsync value.
   */
  mouthSync(): number {
    if (this.currentAnalyzer) {
      return SoundManager.analyze(this.currentAnalyzer)
    } else {
      return 0
    }
  }

  /**
   * Destroys the instance and releases all resources.
   * @emits {@link MotionManagerEvents.destroy}
   */
  destroy() {
    this.destroyed = true
    this.emit('destroy')

    this.stopAllMotions()
    this.expressionManager?.destroy()

    const self = this as Mutable<Partial<this>>
    self.definitions = undefined
    self.motionGroups = undefined
  }

  /**
   * Checks if the motion playback has finished.
   * @abstract
   */
  abstract isFinished(): boolean

  /**
   * Creates a Motion from the data.
   * @param data - Content of the motion file. The format must be consistent with {@link MotionManager#motionDataType}.
   * @param group - The motion group.
   * @param definition - The motion definition.
   * @returns The created Motion.
   * @abstract
   */
  abstract createMotion(
    data: ArrayBuffer | JSONObject,
    group: string,
    definition: MotionSpec
  ): Motion

  /**
   * Retrieves the motion's file path by its definition.
   * @param definition - Motion definition.
   * @returns The file path extracted from the given definition. Not resolved.
   * @abstract
   */
  abstract getMotionFile(definition: MotionSpec): string

  /**
   * Retrieves the motion's name by its definition.
   * @param definition - Motion definition.
   * @returns The motion's name.
   * @protected
   * @abstract
   */
  protected abstract getMotionName(definition: MotionSpec): string

  /**
   * Retrieves the motion's sound file by its definition.
   * @param definition - Motion definition.
   * @returns The motion's sound file, or undefined.
   * @protected
   * @abstract
   */
  protected abstract getSoundFile(definition: MotionSpec): string | undefined

  /**
   * Starts the Motion.
   * @param motion - The Motion to start.
   * @param onFinish - Optional callback when finished.
   * @returns An ID or token for the motion.
   * @protected
   * @abstract
   */
  protected abstract _startMotion(motion: Motion, onFinish?: (motion: Motion) => void): number

  /**
   * Stops all playing motions.
   * @protected
   * @abstract
   */
  protected abstract _stopAllMotions(): void

  /**
   * Updates parameters of the core model.
   * @param model - The core model.
   * @param now - Current time in milliseconds.
   * @return True if the parameters have been actually updated.
   * @protected
   * @abstract
   */
  protected abstract updateParameters(model: object, now: DOMHighResTimeStamp): boolean

  /**
   * Loads a motion and applies the given expression with FORCE priority.
   * @param group - The motion group.
   * @param index - The motion index.
   * @param expression - Expression to apply (optional).
   * @returns The loaded motion, or null if not started.
   * @protected
   */
  protected async getMotionAndApplyExpression(
    group: string,
    index: number,
    expression?: number | string
  ): Promise<unknown> {
    if (!this.state.reserve(group, index, MotionPriority.FORCE)) {
      return null
    }

    const definition = this.definitions[group]?.[index]

    if (!definition) {
      return null
    }

    if (this.currentAudio) {
      SoundManager.dispose(this.currentAudio)
    }

    const motion = (await this.loadMotion(group, index)) as Live2DMotion

    if (!this.state.start(motion, group, index, MotionPriority.FORCE)) {
      return null
    }

    if (this.state.shouldOverrideExpression()) {
      if (this.expressionManager) this.expressionManager.resetExpression()
    }

    logger.log(this.tag, 'Start motion:', this.getMotionName(definition))

    this.emit('motionStart', group, index, undefined)

    if (expression && this.expressionManager && this.state.shouldOverrideExpression()) {
      await this.expressionManager.setExpression(expression)
    }

    return motion
  }

  /**
   * Play the last frame of the given motion, optionally applying an expression.
   * @param group - Motion group.
   * @param index - Motion index.
   * @param expression - Expression to apply (optional).
   * @returns Promise resolving to true if successful.
   * @abstract
   */
  abstract motionLastFrame(
    group: string,
    index: number,
    {
      expression
    }: {
      expression?: number | string
    }
  ): Promise<boolean>
}
