import type { InternalModelOptions } from '@/cubism-common'
import type { CommonHitArea, CommonLayout } from '@/cubism-common/InternalModel'
import { InternalModel } from '@/cubism-common/InternalModel'
import type { Cubism4ModelSettings } from '@/cubism4/Cubism4ModelSettings'
import { Cubism4MotionManager } from '@/cubism4/Cubism4MotionManager'
import { Cubism4ParallelMotionManager } from '@/cubism4/Cubism4ParallelMotionManager'
import {
  ParamAngleX,
  ParamAngleY,
  ParamAngleZ,
  ParamBodyAngleX,
  ParamBreath,
  ParamEyeBallX,
  ParamEyeBallY,
  ParamMouthForm
} from '@cubism/cubismdefaultparameterid'
import { BreathParameterData, CubismBreath } from '@cubism/effect/cubismbreath'
import { CubismEyeBlink } from '@cubism/effect/cubismeyeblink'
import type { CubismPose } from '@cubism/effect/cubismpose'
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44'
import type { CubismModel } from '@cubism/model/cubismmodel'
import type { CubismPhysics } from '@cubism/physics/cubismphysics'
import { CubismRenderer_WebGL, CubismShader_WebGL } from '@cubism/rendering/cubismrenderer_webgl'
import { Matrix } from '@pixi/core'
import type { Mutable } from '@/types/helpers'
import { clamp } from '@/utils'

const tempMatrix = new CubismMatrix44()

// noinspection JSUnusedGlobalSymbols
export class Cubism4InternalModel extends InternalModel {
  settings: Cubism4ModelSettings
  options: InternalModelOptions
  coreModel: CubismModel
  motionManager: Cubism4MotionManager
  parallelMotionManager: Cubism4ParallelMotionManager[]

  lipSync = true

  breath = CubismBreath.create()
  eyeBlink?: CubismEyeBlink

  declare pose?: CubismPose
  declare physics?: CubismPhysics

  renderer = new CubismRenderer_WebGL()

  idParamAngleX = ParamAngleX
  idParamAngleY = ParamAngleY
  idParamAngleZ = ParamAngleZ
  idParamEyeBallX = ParamEyeBallX
  idParamEyeBallY = ParamEyeBallY
  idParamBodyAngleX = ParamBodyAngleX
  idParamBreath = ParamBreath
  idParamMouthForm = ParamMouthForm

  /**
   * The model's internal scale, defined in the moc3 file.
   */
  readonly pixelsPerUnit: number = 1

  /**
   * Matrix that scales by {@link pixelsPerUnit}, and moves the origin from top-left to center.
   *
   * FIXME: This shouldn't be named as "centering"...
   */
  protected centeringTransform = new Matrix()

  constructor(
    coreModel: CubismModel,
    settings: Cubism4ModelSettings,
    options?: InternalModelOptions
  ) {
    super()

    this.coreModel = coreModel
    this.settings = settings
    this.options = Object.assign({}, { breathDepth: 1 }, options)
    this.motionManager = new Cubism4MotionManager(this)
    this.parallelMotionManager = []

    this.init()
  }

  protected init() {
    super.init()

    if (this.settings.getEyeBlinkParameters()?.length) {
      this.eyeBlink = CubismEyeBlink.create(this.settings)
    }
    this.breath.setParameters([
      new BreathParameterData(
        this.idParamAngleX,
        0.0,
        15.0 * this.options.breathDepth!,
        6.5345,
        0.5
      ),
      new BreathParameterData(
        this.idParamAngleY,
        0.0,
        8.0 * this.options.breathDepth!,
        3.5345,
        0.5
      ),
      new BreathParameterData(
        this.idParamAngleZ,
        0.0,
        10.0 * this.options.breathDepth!,
        5.5345,
        0.5
      ),
      new BreathParameterData(
        this.idParamBodyAngleX,
        0.0,
        4.0 * this.options.breathDepth!,
        15.5345,
        0.5
      ),
      new BreathParameterData(this.idParamBreath, 0.0, 0.5, 3.2345, 0.5)
    ])

    this.renderer.initialize(this.coreModel)
    this.renderer.setIsPremultipliedAlpha(true)
  }

  protected getSize(): [number, number] {
    return [
      this.coreModel.getModel().canvasinfo.CanvasWidth,
      this.coreModel.getModel().canvasinfo.CanvasHeight
    ]
  }

  protected getLayout(): CommonLayout {
    const layout: CommonLayout = {}

    if (this.settings.layout) {
      // un-capitalize each key to satisfy the common layout format
      // e.g. CenterX -> centerX
      for (const [key, value] of Object.entries(this.settings.layout)) {
        const commonKey = key.charAt(0).toLowerCase() + key.slice(1)

        layout[commonKey as keyof CommonLayout] = value
      }
    }

    return layout
  }

  protected setupLayout() {
    super.setupLayout()
    ;(this as Mutable<this>).pixelsPerUnit = this.coreModel.getModel().canvasinfo.PixelsPerUnit

    // move the origin from top left to center
    this.centeringTransform
      .scale(this.pixelsPerUnit, this.pixelsPerUnit)
      .translate(this.originalWidth / 2, this.originalHeight / 2)
  }

  updateWebGLContext(gl: WebGLRenderingContext, glContextID: number): void {
    // reset resources that were bound to previous WebGL context
    this.renderer.firstDraw = true
    this.renderer._bufferData = {
      vertex: null,
      uv: null,
      index: null
    }
    this.renderer.startUp(gl)
    // null when the model not using mask
    if (this.renderer._clippingManager) {
      this.renderer._clippingManager._currentFrameNo = glContextID
      this.renderer._clippingManager._maskTexture = undefined
    }
    CubismShader_WebGL.getInstance()._shaderSets = []
  }

  bindTexture(index: number, texture: WebGLTexture): void {
    this.renderer.bindTexture(index, texture)
  }

  protected getHitAreaDefs(): CommonHitArea[] {
    return (
      this.settings.hitAreas?.map((hitArea) => ({
        id: hitArea.Id,
        name: hitArea.Name,
        index: this.coreModel.getDrawableIndex(hitArea.Id)
      })) ?? []
    )
  }

  getDrawableIDs(): string[] {
    return this.coreModel.getDrawableIds()
  }

  getDrawableIndex(id: string): number {
    return this.coreModel.getDrawableIndex(id)
  }

  getDrawableVertices(drawIndex: number | string): Float32Array {
    if (typeof drawIndex === 'string') {
      drawIndex = this.coreModel.getDrawableIndex(drawIndex)

      if (drawIndex === -1) throw new TypeError('Unable to find drawable ID: ' + drawIndex)
    }

    const arr = this.coreModel.getDrawableVertices(drawIndex).slice()

    for (let i = 0; i < arr.length; i += 2) {
      arr[i] = arr[i]! * this.pixelsPerUnit + this.originalWidth / 2
      arr[i + 1] = -arr[i + 1]! * this.pixelsPerUnit + this.originalHeight / 2
    }

    return arr
  }

  updateTransform(transform: Matrix) {
    this.drawingMatrix
      .copyFrom(this.centeringTransform)
      .prepend(this.localTransform)
      .prepend(transform)
  }

  public update(dt: DOMHighResTimeStamp, now: DOMHighResTimeStamp): void {
    super.update(dt, now)

    // cubism4 uses seconds
    dt /= 1000
    now /= 1000

    const model = this.coreModel

    const motionUpdated = this.updateMotions(model, now)

    model.saveParameters()

    this.motionManager.expressionManager?.update(model, now)

    if (!motionUpdated) {
      this.eyeBlink?.updateParameters(model, dt)
    }

    this.updateFocus()

    // revert the timestamps to be milliseconds
    this.updateNaturalMovements(dt * 1000, now * 1000)

    if (this.lipSync && this.motionManager.currentAudio) {
      let value = this.motionManager.mouthSync()
      let min_ = 0
      const max_ = 1
      const weight = 1.2
      if (value > 0) {
        min_ = 0.4
      }
      value = clamp(value * weight, min_, max_)

      for (let i = 0; i < this.motionManager.lipSyncIds.length; ++i) {
        model.addParameterValueById(this.motionManager.lipSyncIds[i], value, 0.8)
      }
    }

    this.physics?.evaluate(model, dt)
    this.pose?.updateParameters(model, dt)

    this.emit('beforeModelUpdate')

    model.update()
    model.loadParameters()
  }

  updateFocus() {
    this.coreModel.addParameterValueById(this.idParamEyeBallX, this.focusController.x) // -1 ~ 1
    this.coreModel.addParameterValueById(this.idParamEyeBallY, this.focusController.y)
    this.coreModel.addParameterValueById(this.idParamAngleX, this.focusController.x * 30) // -30 ~ 30
    this.coreModel.addParameterValueById(this.idParamAngleY, this.focusController.y * 30)
    this.coreModel.addParameterValueById(
      this.idParamAngleZ,
      this.focusController.x * this.focusController.y * -30
    )
    this.coreModel.addParameterValueById(this.idParamBodyAngleX, this.focusController.x * 10) // -10 ~ 10
  }

  updateFacialEmotion(mouthForm: number) {
    this.coreModel.addParameterValueById(this.idParamMouthForm, mouthForm) // -1 ~ 1
  }

  updateNaturalMovements(dt: DOMHighResTimeStamp, _now: DOMHighResTimeStamp) {
    this.breath?.updateParameters(this.coreModel, dt / 1000)
  }

  draw(gl: WebGLRenderingContext): void {
    const matrix = this.drawingMatrix
    const array = tempMatrix.getArray()

    // set given 3x3 matrix into a 4x4 matrix, with Y inverted
    array[0] = matrix.a
    array[1] = matrix.b
    array[4] = -matrix.c
    array[5] = -matrix.d
    array[12] = matrix.tx
    array[13] = matrix.ty

    this.renderer.setMvpMatrix(tempMatrix)
    this.renderer.setRenderState(gl.getParameter(gl.FRAMEBUFFER_BINDING), this.viewport)
    this.renderer.drawModel()
  }

  extendParallelMotionManager(managerCount: number) {
    while (this.parallelMotionManager.length < managerCount) {
      this.parallelMotionManager.push(new Cubism4ParallelMotionManager(this))
    }
  }

  destroy() {
    super.destroy()

    this.renderer.release()
    this.coreModel.release()
    ;(this as Partial<this>).renderer = undefined
    ;(this as Partial<this>).coreModel = undefined
  }
}
