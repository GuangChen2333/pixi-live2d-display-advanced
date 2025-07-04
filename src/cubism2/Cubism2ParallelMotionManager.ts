import type { MotionManager } from '@/cubism-common/MotionManager'
import { ParallelMotionManager } from '@/cubism-common/ParallelMotionManager'
import type { Cubism2ModelSettings } from '@/cubism2/Cubism2ModelSettings'
import type { Cubism2Spec } from '@/types/Cubism2Spec'
import type { Mutable } from '@/types/helpers'
import './patch-motion'
import { MotionPriority } from '@/cubism-common'
import type { Live2DModel } from '@/Live2DModel'

export class Cubism2ParallelMotionManager extends ParallelMotionManager<
  Live2DMotion,
  Cubism2Spec.Motion
> {
  readonly queueManager = new MotionQueueManager()

  constructor(settings: Cubism2ModelSettings, manager: MotionManager) {
    super(settings, manager)
  }

  isFinished(): boolean {
    return this.queueManager.isFinished()
  }

  protected getMotionName(definition: Cubism2Spec.Motion): string {
    return definition.file
  }

  protected _startMotion(motion: Live2DMotion, onFinish?: (motion: Live2DMotion) => void): number {
    motion.onFinishHandler = onFinish

    this.queueManager.stopAllMotions()

    return this.queueManager.startMotion(motion)
  }

  protected _stopAllMotions(): void {
    this.queueManager.stopAllMotions()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected updateParameters(model: Live2DModelWebGL, _now: DOMHighResTimeStamp): boolean {
    return this.queueManager.updateParam(model)
  }

  destroy() {
    super.destroy()
    ;(this as Partial<Mutable<this>>).queueManager = undefined
  }

  async playMotionLastFrame(model: Live2DModel, group: string, index: number): Promise<boolean> {
    if (!this.state.reserve(group, index, MotionPriority.FORCE)) {
      return false
    }

    const definition = this.manager.definitions[group]?.[index]
    if (!definition) {
      return false
    }

    const motion = (await this.manager.loadMotion(group, index)) as Live2DMotion
    if (!this.state.start(motion, group, index, MotionPriority.FORCE)) {
      return false
    }

    this.queueManager.stopAllMotions()

    this.emit('motionStart', group, index, undefined)

    this.playing = true

    const duration = motion.getDurationMSec()

    const motionQueueEntNo = this.queueManager.startMotion(motion, true)

    const motionQueueEnt = this.queueManager.motions.find(
      (entry) => entry && entry._$sr === motionQueueEntNo
    )

    if (!motionQueueEnt) {
      return false
    }

    motion.updateParamExe(
      model.internalModel.coreModel as Live2DModelWebGL,
      duration,
      1.0,
      motionQueueEnt
    )

    this.playing = false
    return true
  }
}
