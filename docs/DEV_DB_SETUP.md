# 本地连接 prod 数据库 —— 开发者上手指南

给团队其他开发成员看的，照着做就能把本地开发环境连上共享的 `stayright` 数据库。

## 第一步：生成一对专用密钥

```bash
ssh-keygen -t ed25519 -f ~/.ssh/stayright-dev-<你的名字> -C "<你的名字>@stayright"
```

会在 `~/.ssh/` 下生成两个文件：

- `stayright-dev-<你的名字>`（**私钥**，留在自己电脑上，不要发给任何人，不要提交进任何仓库）
- `stayright-dev-<你的名字>.pub`（**公钥**，发给 Zachary 用的就是这个）

## 第二步：把公钥发给 Zachary

把 `.pub` 文件发给 Zachary（Slack 私信、邮件都可以——公钥本身不是敏感信息，泄露了也没关系，它只能拿来加白名单，加不了任何权限）。

**不要**把私钥文件发出去，**不要**把私钥提交进仓库。

## 第三步：等 Zachary 回复

Zachary 会分两次分开发给你：

1. 一段隧道命令模板
2. 数据库密码（走安全渠道单独发，跟隧道命令分开）

## 第四步：开隧道

```bash
ssh -i ~/.ssh/stayright-dev-<你的名字> -f -N \
  -L 15432:stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com:5432 \
  ec2-user@3.105.155.148
```

`-f -N` 让它在后台跑、不占终端。这条命令只会给你开一条到数据库的隧道，**登不了那台 EC2 的 shell**——不是权限没给全，是设计上就只放行了转发，属于正常现象。

隧道不是常驻服务，不用时可以关掉：

```bash
pkill -f "L 15432:stayright-prod-db"
```

## 第五步：配置本地 `.env`

```
PGHOST=127.0.0.1
PGPORT=15432
PGDATABASE=stayright
PGUSER=app
PGPASSWORD=<Zachary 单独发给你的密码>
```

之后跑后端/前端参考项目里已有的本地开发流程（`docs/DATABASE_ACCESS.md`），不需要再改别的配置。

## 注意事项

- 这是**共享的 prod 数据库**，不是你独占的测试库——不要手动改表、不要 `DROP`/`TRUNCATE`。
- 后端启动默认不会自动跑数据库迁移，要动 schema 得走项目约定的迁移流程，不要在本地随手加 `RUN_DB_MIGRATE=1` 之外的操作。
- 遇到连不上的问题（隧道起不来、密码不对），先确认隧道有没有正常开着（`ps aux | grep 15432`），再找 Zachary。
