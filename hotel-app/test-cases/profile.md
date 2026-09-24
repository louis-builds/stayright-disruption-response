# ProfileScreen 测试用例

页面: `src/features/profile/ProfileScreen.tsx` + `PerksSection.tsx` + `PolicySection.tsx`（酒店业务档案，5 个 tab）
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互点。

## 1. Tab 切换

- TP1.1 5 个 tab（Overview / Hotel details / Room types / Refund policy / Perks）都能点击切换，内容对应正确。
- TP1.2 切换 tab 时内容有淡入过渡（`tabFade` 220ms）。
- TP1.3 tab 有 `accessibilityRole="tab"` + `aria-selected`，当前选中 tab 为 `"true"`，其余为 `"false"`。

## 2. Overview 房型预览卡

- TP2.1 Overview 展示最多 4 张房型预览卡（`compact`，不显示描述/设施）。
- TP2.2 点击房型预览卡直接跳到 Room types tab 并进入该房型的编辑态（不是先跳列表再手动点）。
- TP2.3 统计卡片（Room types / Perks / From-night）点击可跳转到对应 tab。

## 3. Hotel details — 酒店照片

- TP3.1 无照片时 PhotoGrid 展示 "No photos yet."。
- TP3.2 已有照片时展示缩略图，当前封面有 "Profile photo" 徽标。
- TP3.3 非封面照片旁有 "Set as profile" 按钮（UI 存在性验证，不实际提交切换真实种子数据的封面）。
- TP3.4 每张照片都有 "Remove" 按钮（UI 存在性验证，不实际删除）。

## 4. Hotel details — 名称/地址/经纬度

- TP4.1 修改酒店名称/地址后输入框正确反映新值（不点 Save，不提交）。
- TP4.2 经纬度输入框逐字符打负数（如 "-37.1"）中途不会被强制清零成 "0"（此前 round 已修复的 bug，本轮验证无回归）。

## 5. Room types 列表（数量分支）

- TP5.1 0 条房型时展示 "No room types yet — add one so guests have something to book."。
- TP5.2 1-3 条房型时列表区域垂直居中（`scrollContentCentered`，避免网格产生的死区空白）。
- TP5.3 房型卡片展示封面图/无图占位、名称、价格、容量。

## 6. Room types 编辑器

- TP6.1 点击房型卡片进入编辑器，"← Back to room types" 链接可见。
- TP6.2 编辑任意字段后 `dirty` 变为 true；点击 Back 弹出 "Discard changes?" 确认框（不实际点确认，避免影响真实数据）。
- TP6.3 未修改（`dirty=false`）时点击 Back 直接返回，不弹确认框。
- TP6.4 "Save room type" 按钮在未修改时为 disabled（避免误以为可以空提交）。
- TP6.5 "Delete" 按钮点击弹出二次确认（"Delete room type" + 房型名 + "can't be undone"）（只验证弹窗出现，不点确认）。
- TP6.6 Amenities 增删：输入后点 "+ Add" 增加一个 chip，点 chip 上的 "×" 移除。
- TP6.7 房型 Photos 区域的 PhotoGrid 不传 `primaryIndex`/`onSetPrimary`，即没有 "Set as profile" 概念（固定用第一张做封面）。

## 7. Perks 目录（可逆操作，真实增删测试）

- TP7.1 目录为空时展示空态提示 + Quick add 建议列表。
- TP7.2 通过 Quick add 建议一键添加一个 perk，目录列表更新。
- TP7.3 手动输入名称 + "+ Add perk" 添加成功。
- TP7.4 点击 "Remove" 删除一个 perk，目录恢复为空（验证增删的最终状态与操作前一致）。

## 8. Refund policy

- TP8.1 未上传文档时展示 "↑ Tap to upload your policy file" 提示。
- TP8.2 已有 policy 内容时文本框展示当前内容，可手动编辑。
- TP8.3 "Detected rules" 区域展示 free-cancellation-hours / fee-percent / fixed-fee / currency 字段。
- TP8.4 Effective dates 两个字段可编辑（格式提示 YYYY-MM-DD HH:mm）。

## 9. 离线状态提示

- TP9.1 `isOnline=false` 时 Hotel details 的 Save 按钮 disabled，出现 "You're offline — reconnect to save changes" 提示（通过浏览器 offline 模式验证）。
- TP9.2 离线时 Room types 的 "+ Add room type" 按钮 disabled，出现对应离线提示。
