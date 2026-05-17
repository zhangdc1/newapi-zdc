# Ubuntu 22.04 + 宝塔 + PostgreSQL + Redis + new-api 同机部署指南

本文按你的服务器条件编写：

- 系统：Ubuntu 22.04
- 面板：宝塔已安装
- 已有环境：Nginx、PHP 8.0、MySQL 5.7、phpMyAdmin
- 目标：停用/不使用 MySQL，改为 PostgreSQL
- 部署方式：Docker Compose
- 服务同机：PostgreSQL / Redis / new-api 全部在同一台服务器
- 服务器配置：4 核 8G，50G 系统盘 + 50G SSD 数据盘

> 这份指南默认你要部署的是当前二开后的本地项目代码，不是官方原版镜像。因此推荐用 Docker 在服务器上从源码构建镜像。

## 1. 配置评估

### 1.1 这台服务器适合什么规模

4 核 8G 同机部署属于“正式起步档”。适合：

| 指标 | 建议范围 |
| --- | --- |
| 注册用户 | 500 - 3000 |
| 日活用户 | 100 - 500 |
| 峰值 API 请求 | 5 - 20 RPS |
| 日 API 请求量 | 10 万 - 50 万 |
| 流式并发请求 | 50 - 200 个左右 |

流式请求会长时间占用连接。粗略估算：

```text
同时转发请求数 ≈ 峰值 RPS × 平均请求持续秒数
```

例子：

```text
10 RPS × 平均 15 秒 = 约 150 个同时转发中的请求
```

### 1.2 内存分配建议

8G 内存建议这样分：

| 服务 | 建议占用 |
| --- | --- |
| Ubuntu + 宝塔 + Nginx | 1G - 1.5G |
| new-api 应用 | 1G - 2G |
| PostgreSQL | 2G - 3G |
| Redis | 512M |
| 系统缓存和余量 | 1G - 2G |

### 1.3 磁盘评估

50G SSD 数据盘可以起步，但要注意日志增长。

粗略估算：

```text
10 万请求/天：日志和数据库增长约 100M - 500M/天
50 万请求/天：约 500M - 2.5G/天
```

建议：

- 数据盘挂载到 `/data`
- PostgreSQL、Redis、new-api 日志、备份都放到 `/data/newapi`
- 开启日志清理
- 每天备份 PostgreSQL
- 后期请求量上来后，把数据盘扩到 100G - 200G

## 2. 总体架构

最终结构：

```text
用户浏览器
   |
   | HTTPS 443
   v
宝塔 Nginx
   |
   | 反代到 127.0.0.1:3000
   v
new-api Docker 容器
   |
   | Docker 内网
   +--> PostgreSQL 容器
   |
   +--> Redis 容器
```

安全原则：

- 外网只开放 80、443、SSH、宝塔面板端口
- new-api 的 3000 端口只绑定本机 `127.0.0.1`
- PostgreSQL 的 5432 不开放外网
- Redis 的 6379 不开放外网
- 不再使用 MySQL 5.7 承载本项目数据

## 3. 部署前准备

### 3.1 登录服务器

用 SSH 登录服务器：

```bash
ssh root@你的服务器IP
```

如果不是 root 用户，后续命令前面加 `sudo`。

### 3.2 更新系统基础包

```bash
apt update
apt upgrade -y
apt install -y curl wget git vim unzip htop lsof ca-certificates gnupg openssl ufw
```

设置时区：

```bash
timedatectl set-timezone Asia/Shanghai
timedatectl
```

## 4. 挂载 50G SSD 数据盘

> 非常重要：格式化磁盘会清空磁盘数据。下面步骤只适合全新的空数据盘。

### 4.1 查看磁盘

```bash
lsblk
```

你大概率会看到类似：

```text
vda    50G  系统盘
vdb    50G  数据盘
```

假设数据盘是 `/dev/vdb`。如果你的机器显示为 `/dev/sdb`、`/dev/nvme1n1`，请把后续命令里的 `/dev/vdb` 改成实际名称。

### 4.2 如果数据盘没有格式化，创建文件系统

确认是空盘后执行：

```bash
mkfs.ext4 /dev/vdb
```

### 4.3 挂载到 `/data`

```bash
mkdir -p /data
mount /dev/vdb /data
df -h
```

### 4.4 设置开机自动挂载

查询 UUID：

```bash
blkid /dev/vdb
```

会看到类似：

```text
/dev/vdb: UUID="xxxx-xxxx" TYPE="ext4"
```

编辑 `/etc/fstab`：

```bash
vim /etc/fstab
```

末尾追加一行，把 UUID 换成你自己的：

```text
UUID=你的UUID /data ext4 defaults,nofail 0 2
```

验证：

```bash
umount /data
mount -a
df -h
```

如果 `df -h` 能看到 `/data`，说明成功。

## 5. 处理宝塔已有 MySQL

你现在宝塔默认安装了 MySQL 5.7 和 phpMyAdmin。本项目改用 PostgreSQL 后，MySQL 可以停用来节省内存。

### 5.1 推荐做法

如果这台服务器没有其它网站使用 MySQL：

1. 打开宝塔面板
2. 进入“软件商店”或“数据库”
3. 停止 MySQL 5.7
4. 设置 MySQL 不开机启动
5. phpMyAdmin 也可以停止或卸载

### 5.2 命令行检查

```bash
systemctl status mysql
```

停止 MySQL：

```bash
systemctl stop mysql
systemctl disable mysql
```

如果宝塔使用的是 `mysqld` 服务名：

```bash
systemctl stop mysqld
systemctl disable mysqld
```

> 如果其它业务还在用 MySQL，不要停。new-api 可以不用 MySQL，MySQL 留着也不影响，只是多占内存。

## 6. 安装 Docker 和 Docker Compose

如果宝塔 Docker 管理器已经安装好 Docker，可以跳过本节，直接检查：

```bash
docker version
docker compose version
```

如果没有 Docker，按 Docker 官方 Ubuntu apt 仓库方式安装。

### 6.1 添加 Docker 官方源

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
```

### 6.2 安装 Docker Engine 和 Compose 插件

```bash
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

启动 Docker：

```bash
systemctl enable docker
systemctl start docker
```

检查：

```bash
docker version
docker compose version
```

## 7. 创建部署目录

```bash
mkdir -p /data/newapi/app
mkdir -p /data/newapi/storage/postgres
mkdir -p /data/newapi/storage/redis
mkdir -p /data/newapi/storage/data
mkdir -p /data/newapi/storage/logs
mkdir -p /data/newapi/backups
```

## 8. 上传或拉取项目代码

### 8.1 如果你有 Git 仓库

```bash
cd /data/newapi
git clone 你的仓库地址 app
cd /data/newapi/app
```

### 8.2 如果你从本地上传

把本机 `D:\newapi` 这个项目上传到服务器：

```text
/data/newapi/app
```

注意不要上传这些大文件和运行产物：

```text
node_modules
.git 可选
logs
data
one-api.db
*.db
*.exe
web/default/dist
web/classic/dist
```

上传后检查：

```bash
cd /data/newapi/app
ls
```

应该能看到：

```text
Dockerfile
docker-compose.yml
go.mod
main.go
web/
```

## 9. 生成强密码和密钥

执行：

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

分别记录为：

```text
POSTGRES_PASSWORD
REDIS_PASSWORD
SESSION_SECRET
```

不要使用：

```text
123456
random_string
password
```

## 10. 编写生产 Docker Compose

进入项目目录：

```bash
cd /data/newapi/app
```

备份原 compose：

```bash
cp docker-compose.yml docker-compose.yml.bak
```

编辑：

```bash
vim docker-compose.yml
```

建议替换为下面内容。请把里面的三个密码改成你刚生成的强密码。

```yaml
version: "3.8"

services:
  new-api:
    build:
      context: .
      dockerfile: Dockerfile
    image: new-api-custom:latest
    container_name: new-api
    restart: always
    command: --log-dir /app/logs
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - /data/newapi/storage/data:/data
      - /data/newapi/storage/logs:/app/logs
    environment:
      - SQL_DSN=postgresql://newapi:你的PostgreSQL强密码@postgres:5432/newapi?sslmode=disable
      - REDIS_CONN_STRING=redis://:你的Redis强密码@redis:6379/0
      - SESSION_SECRET=你的SESSION_SECRET随机字符串
      - CRYPTO_SECRET=你的SESSION_SECRET随机字符串
      - TZ=Asia/Shanghai
      - ERROR_LOG_ENABLED=true
      - BATCH_UPDATE_ENABLED=true
      - SQL_MAX_IDLE_CONNS=20
      - SQL_MAX_OPEN_CONNS=100
      - SQL_MAX_LIFETIME=60
      - GLOBAL_API_RATE_LIMIT=1200
      - GLOBAL_API_RATE_LIMIT_DURATION=60
      - GLOBAL_WEB_RATE_LIMIT=600
      - GLOBAL_WEB_RATE_LIMIT_DURATION=60
      - STREAMING_TIMEOUT=300
      - RELAY_TIMEOUT=0
      - NODE_NAME=new-api-node-1
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - new-api-network
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://localhost:3000/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    container_name: new-api-postgres
    restart: always
    environment:
      POSTGRES_USER: newapi
      POSTGRES_PASSWORD: 你的PostgreSQL强密码
      POSTGRES_DB: newapi
      TZ: Asia/Shanghai
    command:
      - "postgres"
      - "-c"
      - "max_connections=200"
      - "-c"
      - "shared_buffers=1GB"
      - "-c"
      - "effective_cache_size=3GB"
      - "-c"
      - "work_mem=8MB"
      - "-c"
      - "maintenance_work_mem=256MB"
    volumes:
      - /data/newapi/storage/postgres:/var/lib/postgresql/data
    networks:
      - new-api-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U newapi -d newapi"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: new-api-redis
    restart: always
    command:
      [
        "redis-server",
        "--requirepass",
        "你的Redis强密码",
        "--maxmemory",
        "512mb",
        "--maxmemory-policy",
        "allkeys-lru",
        "--appendonly",
        "yes"
      ]
    volumes:
      - /data/newapi/storage/redis:/data
    networks:
      - new-api-network

networks:
  new-api-network:
    driver: bridge
```

保存后检查配置格式：

```bash
docker compose config
```

如果能正常输出完整配置，说明 YAML 格式基本没问题。

## 11. 首次启动

进入项目目录：

```bash
cd /data/newapi/app
```

构建并启动：

```bash
docker compose up -d --build
```

首次构建会下载 Bun、Go、依赖和基础镜像，可能需要 5 - 30 分钟，取决于服务器网络。

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f new-api
```

看到数据库迁移成功、服务监听 3000，说明后端启动了。

本机测试：

```bash
curl http://127.0.0.1:3000/api/status
```

返回里有 `success` 就可以继续配置 Nginx。

## 12. 宝塔 Nginx 反向代理

### 12.1 添加站点

在宝塔面板：

1. 网站
2. 添加站点
3. 域名填你的域名，例如：

```text
api.example.com
```

4. PHP 版本选择“纯静态”或“不使用 PHP”
5. 根目录可以随便建，例如：

```text
/www/wwwroot/api.example.com
```

### 12.2 配置反向代理

宝塔站点设置里找到“反向代理”，添加：

```text
目标 URL：http://127.0.0.1:3000
发送域名：$host
```

如果宝塔支持高级配置，把下面配置放进站点 Nginx 配置的 `server {}` 内。

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 50m;
}
```

这几个设置很重要：

- `proxy_buffering off`：避免流式输出被 Nginx 缓冲
- `proxy_read_timeout 3600s`：避免长回答中途断开
- `Authorization`：保证 API Key 请求头传到后端
- `client_max_body_size 50m`：避免上传图片或大请求被 Nginx 拦截

### 12.3 配置 HTTPS

宝塔站点设置：

1. SSL
2. Let's Encrypt
3. 申请证书
4. 开启强制 HTTPS

访问：

```text
https://你的域名
```

## 13. 防火墙和安全组

### 13.1 云服务器安全组

只开放：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH，建议只允许你的 IP |
| 80 | HTTP |
| 443 | HTTPS |
| 宝塔面板端口 | 例如 8888，建议只允许你的 IP |

不要开放：

| 端口 | 原因 |
| --- | --- |
| 3000 | 只给 Nginx 本机反代 |
| 5432 | PostgreSQL 不给外网 |
| 6379 | Redis 不给外网 |

### 13.2 Ubuntu UFW

如果你使用 UFW：

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 宝塔面板端口/tcp
ufw enable
ufw status
```

如果宝塔防火墙已经接管，可以在宝塔面板里配置。

## 14. 首次进入系统

浏览器打开：

```text
https://你的域名
```

如果是首次初始化，会进入初始化或登录流程。

建议初始化后立刻做：

1. 修改管理员密码
2. 关闭普通用户注册，除非你确实要开放注册
3. 配置支付前先确保支付回调域名正确
4. 添加模型渠道
5. 设置模型价格和倍率
6. 创建测试 API Key
7. 调用一次 `/v1/chat/completions` 测试

## 15. 常用运维命令

进入部署目录：

```bash
cd /data/newapi/app
```

查看状态：

```bash
docker compose ps
```

查看 new-api 日志：

```bash
docker compose logs -f new-api
```

查看 PostgreSQL 日志：

```bash
docker compose logs -f postgres
```

查看 Redis 日志：

```bash
docker compose logs -f redis
```

重启：

```bash
docker compose restart
```

只重启应用：

```bash
docker compose restart new-api
```

停止：

```bash
docker compose down
```

> 不要随便执行 `docker compose down -v`，它会删除 Docker 卷。虽然本文使用的是绑定目录，但你以后如果改成命名卷，`-v` 可能导致数据丢失。

## 16. 数据备份

### 16.1 手动备份 PostgreSQL

```bash
mkdir -p /data/newapi/backups
docker exec new-api-postgres pg_dump -U newapi -d newapi > /data/newapi/backups/newapi_$(date +%F_%H%M%S).sql
```

压缩：

```bash
gzip /data/newapi/backups/newapi_*.sql
```

### 16.2 备份应用数据和日志

```bash
tar -czf /data/newapi/backups/newapi_files_$(date +%F_%H%M%S).tar.gz \
  /data/newapi/storage/data \
  /data/newapi/storage/logs
```

### 16.3 自动每日备份

创建脚本：

```bash
vim /data/newapi/backup.sh
```

内容：

```bash
#!/usr/bin/env bash
set -e

BACKUP_DIR=/data/newapi/backups
mkdir -p "$BACKUP_DIR"

docker exec new-api-postgres pg_dump -U newapi -d newapi | gzip > "$BACKUP_DIR/newapi_$(date +%F_%H%M%S).sql.gz"

tar -czf "$BACKUP_DIR/newapi_files_$(date +%F_%H%M%S).tar.gz" \
  /data/newapi/storage/data \
  /data/newapi/storage/logs

find "$BACKUP_DIR" -type f -mtime +14 -delete
```

授权：

```bash
chmod +x /data/newapi/backup.sh
```

添加定时任务：

```bash
crontab -e
```

每天凌晨 3 点备份：

```text
0 3 * * * /data/newapi/backup.sh >> /data/newapi/backups/backup.log 2>&1
```

## 17. 恢复备份

### 17.1 恢复前先停应用

```bash
cd /data/newapi/app
docker compose stop new-api
```

### 17.2 清空数据库并恢复

谨慎执行。假设备份文件是：

```text
/data/newapi/backups/newapi_2026-05-17_030000.sql.gz
```

恢复：

```bash
gunzip -c /data/newapi/backups/newapi_2026-05-17_030000.sql.gz | docker exec -i new-api-postgres psql -U newapi -d newapi
```

如果数据库里已有旧数据，可能需要先清库。清库操作风险高，建议先联系技术人员确认。

### 17.3 启动应用

```bash
docker compose start new-api
docker compose logs -f new-api
```

## 18. 更新二开版本

### 18.1 如果服务器使用 Git

```bash
cd /data/newapi/app
git pull
docker compose up -d --build
```

### 18.2 如果你从本地上传代码

1. 本地确认代码是二开后的版本
2. 上传覆盖 `/data/newapi/app`
3. 不要覆盖这些目录：

```text
/data/newapi/storage
/data/newapi/backups
```

4. 重新构建：

```bash
cd /data/newapi/app
docker compose up -d --build
```

### 18.3 清理 Docker 构建缓存

如果 50G 数据盘快满：

```bash
docker system df
docker builder prune
```

更激进的清理：

```bash
docker image prune -a
```

> 注意：`docker image prune -a` 会删除未使用镜像，下次构建会重新下载。

## 19. 性能参数建议

### 19.1 new-api 环境变量

当前 4 核 8G 推荐：

```env
SQL_MAX_IDLE_CONNS=20
SQL_MAX_OPEN_CONNS=100
SQL_MAX_LIFETIME=60
GLOBAL_API_RATE_LIMIT=1200
GLOBAL_API_RATE_LIMIT_DURATION=60
GLOBAL_WEB_RATE_LIMIT=600
GLOBAL_WEB_RATE_LIMIT_DURATION=60
STREAMING_TIMEOUT=300
RELAY_TIMEOUT=0
```

如果出现数据库连接过多：

```env
SQL_MAX_OPEN_CONNS=50
SQL_MAX_IDLE_CONNS=10
```

如果高峰请求被 429 限制：

```env
GLOBAL_API_RATE_LIMIT=2400
GLOBAL_WEB_RATE_LIMIT=1200
```

但不要盲目调太高。先看 CPU、内存、数据库连接数。

### 19.2 PostgreSQL

当前 compose 已设置：

```text
max_connections=200
shared_buffers=1GB
effective_cache_size=3GB
work_mem=8MB
maintenance_work_mem=256MB
```

4 核 8G 同机部署不建议一开始开太大。

### 19.3 Redis

当前 compose 已限制：

```text
maxmemory=512mb
maxmemory-policy=allkeys-lru
appendonly=yes
```

Redis 主要用于缓存、限流、同步。512M 对起步够用。

## 20. 日志清理

查看日志目录大小：

```bash
du -sh /data/newapi/storage/logs
du -sh /data/newapi/storage/postgres
```

查看 Docker 日志大小：

```bash
du -sh /var/lib/docker/containers
```

如果 Docker 容器日志增长太大，可以配置 Docker 日志轮转：

```bash
vim /etc/docker/daemon.json
```

写入：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
```

重启 Docker：

```bash
systemctl restart docker
```

然后启动服务：

```bash
cd /data/newapi/app
docker compose up -d
```

## 21. 常见问题排查

### 21.1 打不开网站

检查：

```bash
docker compose ps
curl http://127.0.0.1:3000/api/status
```

如果本机 curl 正常，但域名打不开，问题在宝塔 Nginx、SSL 或安全组。

### 21.2 显示 502 Bad Gateway

通常是 Nginx 反代不到应用。

检查：

```bash
docker compose logs --tail=100 new-api
curl http://127.0.0.1:3000/api/status
```

确认宝塔反代目标是：

```text
http://127.0.0.1:3000
```

### 21.3 数据库连接失败

看日志：

```bash
docker compose logs --tail=100 new-api
docker compose logs --tail=100 postgres
```

重点检查：

- `SQL_DSN` 用户名是否是 `newapi`
- `SQL_DSN` 密码是否和 `POSTGRES_PASSWORD` 一致
- 数据库名是否都是 `newapi`
- 主机名是否是 Docker 服务名 `postgres`

### 21.4 Redis 连接失败

检查：

```bash
docker compose logs --tail=100 redis
docker compose logs --tail=100 new-api
```

重点检查：

- `REDIS_CONN_STRING` 里的密码
- Redis 服务名是否是 `redis`
- URL 是否写成 `redis://:密码@redis:6379/0`

### 21.5 登录后会话失效

检查 `SESSION_SECRET`：

```bash
docker compose exec new-api env | grep SESSION_SECRET
```

要求：

- 不能为空
- 不能是 `random_string`
- 后续升级不要随便改，否则会导致已有登录会话失效

### 21.6 流式输出中断

重点检查宝塔 Nginx 配置：

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

也可以提高：

```env
STREAMING_TIMEOUT=600
```

然后：

```bash
docker compose up -d
```

### 21.7 构建很慢或失败

常见原因：

- 服务器网络拉取 Docker 镜像慢
- 上传了 `node_modules` 导致构建上下文巨大
- 数据盘空间不足

检查：

```bash
df -h
docker system df
```

清理：

```bash
docker builder prune
```

## 22. 上线检查清单

上线前逐项确认：

- [ ] 数据盘已经挂载到 `/data`
- [ ] MySQL 已停用或确认不影响
- [ ] Docker 和 Docker Compose 可用
- [ ] PostgreSQL 密码已改强密码
- [ ] Redis 密码已改强密码
- [ ] `SESSION_SECRET` 已设置随机长字符串
- [ ] `CRYPTO_SECRET` 已设置
- [ ] 3000 只绑定 `127.0.0.1`
- [ ] 5432、6379 没有开放外网
- [ ] 宝塔 Nginx 已反代到 `127.0.0.1:3000`
- [ ] HTTPS 已开启
- [ ] `/api/status` 正常
- [ ] 管理员密码已修改
- [ ] 普通注册策略已确认
- [ ] 支付回调域名已确认
- [ ] 已配置每日数据库备份
- [ ] 已测试 API Key 调用

## 23. 推荐的目录结构

最终推荐保持：

```text
/data/newapi
├── app                         # 项目代码
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── go.mod
│   └── web
├── storage
│   ├── data                    # new-api 数据目录
│   ├── logs                    # new-api 日志
│   ├── postgres                # PostgreSQL 数据
│   └── redis                   # Redis 数据
└── backups                     # 备份
```

## 24. 资料来源

- Docker 官方 Ubuntu 安装文档：https://docs.docker.com/engine/install/ubuntu/
- Docker Compose 官方安装文档：https://docs.docker.com/compose/install/linux/
- PostgreSQL Docker 官方镜像说明：https://hub.docker.com/_/postgres
- Redis Docker 官方镜像说明：https://hub.docker.com/_/redis

