# 团队数据库访问权限开通方案（内部运维文档）

**日期**：2026-09-23
**负责人**：Zachary（本账户唯一 cloud owner）
**适用范围**：`ictgs-team5` 账户下 `stayright-prod-bastion` EC2 跳板机 + `stayright-prod-db` RDS

> ⚠️ **本文档面向 Zachary 自己 / 未来维护者**，记录的是决策背景和管理员操作，**不要直接把这份文档发给开发团队**。要发给开发团队照着操作的，是 **`docs/DEV_DB_SETUP.md`**——那份只包含他们需要的步骤（生成密钥、发公钥、开隧道、配 `.env`），没有这份文档里的管理员命令和内部决策记录。

---

## 1. 背景与约束

- 本账户的登录身份（`AWSReservedSSO_ICTGSStudentPermissionSet`）对 IAM 彻底锁死：`CreateRole`、`CreateUser`、`AttachRolePolicy`、`PassRole` 全部 `AccessDenied`，连只读的 `GetRole` 都不行。这是**课程侧永久设定**，不是临时权限缺口，Zachary 本人在控制台操作也会卡在同一处。
- 因此原计划的「给 4 个开发者各建一个 IAM User + 走 SSM 隧道连库」这条路**走不通**，已在 `docs/AWS_SDK_SPEC.md` §8.1 记录为作废方案。
- 替代方案：**EC2 跳板机 + SSH key，OS 级别管理，不依赖任何 IAM 权限**。这是已经落地并且在跑的方案（Zachary 本人目前就是这样连库的）。
- 跳板机的 22 端口本来就对 `0.0.0.0/0` 开放（`sg-0d93f9ad6ed86fe26`），只靠 SSH key 认证防护——给团队开权限**不需要改安全组**。

## 2. 方案概述

每个开发者用自己的密钥对（不是共享同一把私钥），只把**公钥**发给 Zachary。Zachary 手动把每个人的公钥追加进跳板机的 `~/.ssh/authorized_keys`，但加上 SSH 限制选项，让这把 key **只能建一条到 RDS `5432` 端口的隧道，不能登录 shell、不能跑任何命令、不能转发到其他任何地址**。

这样即使某个开发者的私钥后续泄露，攻击者能做的最坏情况也只是连上数据库（如果同时拿到了数据库密码的话），进不了 EC2 本身、碰不到跳板机上的任何其他东西。

数据库密码本身**不经过这套 SSH key 机制**，走单独的安全渠道（1Password / 加密聊天）一对一发给每个开发者，不落地在仓库、脚本或 Slack 明文消息里。

## 3. 交付物

| 文件 | 作用 |
|---|---|
| `scripts/add-dev-ssh-key.sh` | Zachary 收到某个开发者的公钥后跑一次，自动把它加进跳板机 `authorized_keys` 并加上限制；跑完打印一段可以直接转发给对方的隧道命令 |
| `docs/DEV_DB_SETUP.md` | **直接发给开发团队**的上手指南，只含他们需要的步骤 |
| `docs/DATABASE_ACCESS.md` §3.2b | 数据库连接文档里的简要指引，指回本文档 |

## 4. 开发者需要做什么

完整步骤在 **`docs/DEV_DB_SETUP.md`**，直接发那份文档给团队即可，这里不重复。开发者侧简单说就是：生成一对专用密钥 → 发公钥给 Zachary（私钥不发） → 等 Zachary 回复隧道命令和密码（分开发） → 开隧道连库。

## 5. Zachary 要做的事（每收到一个公钥跑一次）

```bash
cd Kakapo
./scripts/add-dev-ssh-key.sh <name> <path-to-their-key.pub>
```

- `<name>`：对方的名字（只能是字母/数字/下划线/短横线，会写进 `authorized_keys` 的标签里，方便以后查找/撤销）
- `<path-to-their-key.pub>`：对方发来的公钥文件路径

脚本会：

1. 校验公钥文件格式（防止误把私钥文件传进去）
2. 打印将要追加的那一行，等你按 `y` 确认
3. SSH 上跳板机（用你自己已有的 `stayright-prod-bastion-key.pem`），把这行追加进 `~/.ssh/authorized_keys`
4. 幂等检查：同一个 `name` 已经加过就跳过，不会重复添加
5. 跑完打印一段隧道命令模板，直接转发给对方即可（把里面的 `<私钥路径>` 换成对方自己的路径）

跑完脚本之后，**单独**（不要和上面的隧道命令一起发）把数据库密码通过 1Password 或加密聊天发给对方：

```bash
aws secretsmanager get-secret-value --secret-id "stayright/prod/db/password" \
  --profile ictgs-team5 --region ap-southeast-2 --query SecretString --output text
```

## 6. 安全边界：这把 key 到底能做什么

`add-dev-ssh-key.sh` 追加的每一行大致是：

```
command="echo 'Port-forwarding only...'",no-pty,no-agent-forwarding,no-X11-forwarding,no-user-rc,permitopen="<rds-host>:5432" ssh-ed25519 AAAA... stayright-dev-<name>
```

| 限制项 | 效果 |
|---|---|
| `permitopen="<rds-host>:5432"` | 只能转发到这一个地址+端口，转发到别的地址/端口会被 SSH 服务端直接拒绝 |
| `no-pty` | 拿不到交互式终端，登不了 shell |
| `no-agent-forwarding` / `no-X11-forwarding` | 不能借这台机器跳到别的机器 |
| `command="echo ..."` | 就算对方硬要 `ssh ec2-user@bastion` 而不是走隧道，也只会看到一行提示文字，不会拿到 shell |

**结论**：这把 key 泄露 ≠ 跳板机被攻破，最坏情况是有人能连上数据库（前提是同时拿到数据库密码），完全碰不到 EC2 本身。

## 7. 撤销某人的权限

SSH 上跳板机，编辑 `~/.ssh/authorized_keys`，删掉末尾标着 `stayright-dev-<name>` 的那一行即可。不需要动 IAM、不需要改安全组、不需要重启任何服务。

## 8. 常见问题

**Q：为什么不直接把 `stayright-prod-bastion-key.pem` 这把主私钥发给大家？**
不可撤销单个人的权限（只能整体换 key，影响所有人），也没有"谁在用哪把 key"的审计线索。每人一把限权 key 是标准做法，撤销/追责都只影响一个人。

**Q：数据库密码为什么不能和公钥一起处理，走同一个脚本？**
公钥不是敏感信息（只能用来加白名单），密码是真正的凭证。两者分开传输、分开渠道，是最基本的凭证卫生——万一 Slack 消息记录泄露，公钥泄露没有实际影响，密码泄露就是真正的风险。

**Q：以后能不能换回 IAM User 的方案？**
这个账户对 IAM 的锁死是课程侧永久设定（`docs/AWS_SDK_SPEC.md` §8.1 已向 Zachary 确认），不是临时限制，短期内不会变。

---

*本文档配套：`scripts/add-dev-ssh-key.sh`、`docs/DEV_DB_SETUP.md`（发给开发团队的版本）、`docs/DATABASE_ACCESS.md` §3.2b。*
