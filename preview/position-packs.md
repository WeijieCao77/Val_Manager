# 位置奖励包与卡背

预览：`/preview/pack.html?position=duelist`。其他参数为 `controller`、`initiator`、`sentinel`。底部可切换四款卡包、单独查看卡背或并排比较四款卡背。

四套共用现有三维软袋、撕封条、稀有度光晕和鼠标倾角。图标按用户附件对应关系绘成矢量，SVG 卡背与 Canvas 包装使用同一组路径。

| UI | 游戏位置参数 | 配色 |
|---|---|---|
| 决斗包 | 决斗者 | 赤红 |
| 控场包 | 控场 | 靛蓝 |
| 先锋包 | 先锋 | 琥珀 |
| 哨位包 | 哨卫 | 青绿 |

## 接入小游戏奖励

当前工作区尚无四个位置小游戏的实现，本次没有新增或修改发奖规则。预览只使用演示卡，不写账号。

真实奖励页面拿到服务端奖励后，调用现有 `PackStage`，额外传入 `position`（类型 `PackPosition`，定义于 `src/ui/cards/positionPackDesign.ts`）：

```tsx
<PackStage position="哨卫" pulled={rewardCards} shown={shown}
  onNext={next} onDone={collect} onSellAll={sellDuplicates} />
```

`pulled` 沿用现有 `Pulled[]`，单张奖励传一个元素。`position` 必须来自奖励的小游戏位置；不要从 `card.roles[0]` 推断，多位置选手可能导致包和卡背不一致。省略此参数时，原选手包和教练包外观保持原样。

只展示背面时可使用 `<CardBack position="哨卫" />`。
