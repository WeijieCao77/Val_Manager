# 发布到哔哩哔哩 Toy 平台

Toy 平台接受**本地制作的静态 HTML 及相关代码**，发布后挂在
`https://www.bilibili.com/toy/<作品名>/index.html` 这样的子路径下。
本项目的产线构建（`dist/`）就是一个自包含的静态站，可以直接作为 Toy 上传。

## 就绪状态（已核对）

| 平台要求 | 本项目 |
| --- | --- |
| 纯静态，入口为根目录 `index.html` | ✅ `npm run build` 产出的 `dist/` 即是 |
| 总大小 ≤ 140MB | ✅ 约 8MB |
| 部署在子路径下资源仍能加载 | ✅ Vite `base: './'`，头像/队徽走 `BASE_URL` 相对路径 |
| 不依赖自有服务器 | ✅ 遥测打不通就静默丢弃；卡牌账号回退 localStorage；生涯模式本来就存在浏览器里 |
| 不加载第三方外链资源 | ✅ 包内无外部 JS/CSS/字体（正文里只有跳转用的超链接） |
| 多设备适配 | ✅ 自带 phone / tablet / desktop 三档布局 |

注意：卡牌模式（`/cards`）在 Toy 上不可达，这是预期行为——它依赖后端签到接口，
而且本来就是不挂链接的未完成模式。玩家在 Toy 上只会进入生涯模式。

## 发布步骤

1. **申请发布权限**（未开通的话）：在 [Toy 开发者小站](https://www.bilibili.com/bubble/home/86)
   按[格式](https://www.bilibili.com/opus/1235998223851585555)发帖介绍创意，48h 内反馈。

2. **构建并打包**（本机执行）：

   ```sh
   npm run pack:toy        # = npm run build + 把 dist/ 内容压成 val-manager-toy.zip
   ```

   或者手动 `npm run build`，上传时选择 `dist/` 文件夹里的**内容**
   （`index.html` 必须位于上传包的根部，不要把 `dist` 这层目录本身包进去）。

3. **用官方 skill 做上传前检查**（可选但推荐）：官方提供了一个 Agent skill
   来按格式规范一键检查/优化上传包，安装入口在
   <https://www.bilibili.com/toy/publish/sdk/skill>。
   在**本机**的 Claude Code 里打开该页面按指示安装（云端沙箱访问不了 bilibili.com），
   然后在项目目录里让它「按 B 站 Toy 规范检查 dist 并打包」。

4. **上传发布**：先在浏览器登录 B 站账号，再在**同一个浏览器**打开
   <https://www.bilibili.com/toy/publish>（否则无法验证身份），上传第 2 步的产物。

5. 遇到问题看 [FAQ](https://www.bilibili.com/toy/publish/guide/faq)；
   发布后想要曝光，填写 8 月的
   [推流申请表](https://docs.qq.com/sheet/DU3dnQkR1WG5RUnp0?tab=BB08J2)，
   并参考[《Toy 发布后怎么被看见》](https://www.bilibili.com/toy/toy-creator-explainer/index.html)。

## 之后值得做的（不阻塞首发）

- **云存档**：生涯存档目前在 localStorage，B 站 webview 清理站点数据会丢档。
  官方 SDK 支持云存档，参考 [toy-cloud-save-lab](https://www.bilibili.com/toy/toy-cloud-save-lab/index.html)。
- **排行榜 / KV / 关注**：demo 与源码见
  [doodle-hop-sdk-demo](https://www.bilibili.com/toy/doodle-hop-sdk-demo/index.html)，
  适合给生涯模式加个「最快夺冠」之类的榜。
- **适配复查**：对照官方
  [多设备适配 demo](https://www.bilibili.com/toy/toy-responsive-demo/index.html)
  在站内 webview 里过一遍手机布局。
