# pixi-live2d-display-advanced

![NPM Version](https://img.shields.io/npm/v/pixi-live2d-display-advanced?style=flat-square&label=version)
![Cubism version](https://img.shields.io/badge/Cubism-2/3/4-ff69b4?style=flat-square)

为 [PixiJS](https://github.com/pixijs/pixi.js) v7 提供的 Live2D 插件

此项目旨在成为 Web 平台上的通用 Live2D 框架。
由于 Live2D 的官方框架非常复杂且不可靠，这个项目已将其重写以提供统一且简单的 API，
使你可以从较高的层次来控制 Live2D 模型而无需了解其内部的工作原理

相较于 [pixi-live2d-display-mulmotion](https://www.npmjs.com/package/pixi-live2d-display-mulmotion), 本项目增加了对
播放动作最末帧的支持。在 Project SEKAI like 项目中大幅地缩短了再次应用动作的时间。

此外，本分支还重构了一些本项目的原始代码，可能提升了部分性能，但大幅提高了代码可读性，利于维护。

#### 特性

- 支持所有版本的 Live2D 模型
- 支持 PIXI.RenderTexture 和 PIXI.Filter
- Pixi.js 风格的变换 API：position, scale, rotation, skew, anchor
- 自动交互：鼠标跟踪, 点击命中检测
- 比官方框架更好的动作预约逻辑
- 从上传的文件或 zip 文件中加载 (实验性功能)
- 完善的类型定义 - 我们都喜欢类型！
- 实时口型同步
- 同时播放多个动作
- 播放动作最末帧

#### 要求

- PixiJS：7.x
- Cubism core: 2.1 or 4
- 浏览器：WebGL， ES6

#### 示例

- [基础示例](https://codepen.io/guansss/pen/oNzoNoz/left?editors=1010)
- [交互示例](https://codepen.io/guansss/pen/KKgXBOP/left?editors=0010)
- [渲染纹理与滤镜示例](https://codepen.io/guansss/pen/qBaMNQV/left?editors=1010)
- [Live2D Viewer Online](https://guansss.github.io/live2d-viewer-web/)
- [多动作同步播放](#多动作同步播放)
- [播放动作最末帧](#播放动作最末帧)

#### 文档

- [文档](https://guansss.github.io/pixi-live2d-display)（暂无中文翻译）
- [API 文档](https://guansss.github.io/pixi-live2d-display/api/index.html)

## Cubism

Cubism 是 Live2D SDK 的名称，目前有 3 个版本：Cubism 2.1、Cubism 3、Cubism 4，其中 Cubism 4 可以与 Cubism 3 的模型兼容

该插件使用 Cubism 2.1 和 Cubism 4，从而支持所有版本的 Live2D 模型

#### Cubism Core

在使用该插件之前，你需要加载 Cubism 运行时，也就是 Cubism Core

Cubism 4 需要加载 `live2dcubismcore.min.js`
，可以从 [Cubism 4 SDK](https://www.live2d.com/download/cubism-sdk/download-web/)
里解压出来，或者直接引用[这个链接](https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js)
（_链接偶尔会挂掉，不要在生产版本中使用！_）

Cubism 2.1 需要加载 `live2d.min.js`，[从 2019/9/4 起](https://help.live2d.com/en/other/other_20/)
，官方已经不再提供该版本 SDK 的下载，但是可以从 [这里](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib)
找到，以及你大概想要的 [CDN 链接](https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js)

#### 单独的打包文件

该插件为每个 Cubism 版本提供了单独的打包文件，从而在你只想使用其中一个版本的时候减少需要加载文件的大小。

具体来说，为两种版本分别提供了 `cubism2.js` 和 `cubism4.js`，以及一个同时包含了两种版本的 `index.js`

注意，如果你想同时支持 Cubism 2.1 和 Cubism 4 的话，请使用 `index.js`，_而不要同时使用_ `cubism2.js` 和 `cubism4.js`

为了更明确一点，这里列出使用这些文件的方法：

- 使用 `cubism2.js`+`live2d.min.js` 以支持 Cubism 2.1 模型
- 使用 `cubism4.js`+`live2dcubismcore.min.js` 以支持 Cubism 3 和 Cubism 4 模型
- 使用 `index.js`+`live2d.min.js`+`live2dcubismcore.min.js` 以支持所有版本的模型

## 安装

#### 通过 npm

```sh
npm install pixi-live2d-display-advanced
```

```js
import { Live2DModel } from 'pixi-live2d-display-advanced'

// 如果只需要 Cubism 2.1
import { Live2DModel } from 'pixi-live2d-display-advanced/cubism2'

// 如果只需要 Cubism 4
import { Live2DModel } from 'pixi-live2d-display-advanced/cubism4'
```

## 基础使用

参阅此处: [pixi-live2d-display-lipsync](https://github.com/RaSan147/pixi-live2d-display)

## 多动作同步播放

```ts
model.parallelMotion([
  { group: motion_group1, index: motion_index1, priority: MotionPriority.NORMAL },
  { group: motion_group2, index: motion_index2, priority: MotionPriority.NORMAL }
])
```

若需要同步播放表情、声音等请使用`model.motion`/`model.speak`播放其中一个动作，其余动作用`model.parallelMotion`播放。
列表中按照 index 每一项都有独立的优先级控制，和`model.motion`逻辑一致。

## 播放动作最末帧

对于单个动作，可以采用简单的:

```ts
await model.motionLastFrame('w-cute12-tilthead', 0)
```

对于多个动作，可以使用:

```ts
await model.parallelLastFrame([
  { group: 'w-cute12-tilthead', index: 0 },
  { group: 'face_worry_01', index: 0 }
])
```

或者:

```ts
model.internalModel.extendParallelMotionManager(2)
const manager1 = model.internalModel.parallelMotionManager[0]!
const manager2 = model.internalModel.parallelMotionManager[1]!
manager1.playMotionLastFrame('w-cute12-tilthead', 0)
manager2.playMotionLastFrame('face_worry_01', 0)
```

实质上，这两个方法是等价的。第一种用法只是第二种用法的语法糖。

## v1.0.0 TODOs

- [ ] 完善文档
- [ ] 更改测试
- [ ] 自动化构建脚本

拟在 v2.0.0 中，项目升级到 pixi.js v8

# 请参阅此处了解更多文档： [文档](https://guansss.github.io/pixi-live2d-display/)
