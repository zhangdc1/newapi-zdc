# Ubuntu 22.04 纯净宝塔部署 new-api 指南

适用场景：

- 服务器系统：Ubuntu 22.04
- 当前状态：只安装了宝塔面板
- 目标部署：new-api + PostgreSQL + Redis
- 部署方式：Docker Compose
- 推荐服务器：4 核 8G，50G 系统盘 + 50G SSD 数据盘
- 访问方式：宝塔 Nginx 反向代理到 new-api

本文按“小白照着做”的方式写。你只需要准备：

```text
服务器 IP
宝塔登录地址
你的域名
当前二开后的 new-api 项目代码
```

## 1. 部署结构

最终结构如下：

```text
用户访问 https://你的域名
        |
        v
宝塔 Nginx 反向代理
        |
        v
127.0.0.1:3000
        |
        v
new-api 容器
   |             |
   v             v
PostgreSQL     Redis
```

安全设计：

- 外网只开放 `80`、`443`、SSH、宝塔端口
- `3000` 只允许本机访问
- PostgreSQL `5432` 不开放外网
- Redis `6379` 不开放外网
- 数据放到 `/data/newapi`

## 2. 配置适用规模

你的 4 核 8G 同机部署适合正式起步：

| 指标 | 建议范围 |
| --- | --- |
| 注册用户 | 500 - 3000 |
| 日活用户 | 100 - 500 |
| 峰值 API 请求 | 5 - 20 RPS |
| 日请求量 | 10 万 - 50 万 |
| 流式并发 | 50 - 200 个左右 |

后期如果用户量上来，优先升级顺序：

```text
数据盘扩容 -> PostgreSQL 独立服务器 -> Redis 独立 -> 多台 new-api + 负载均衡
```

## 3. 登录服务器

用 SSH 登录：

```bash
ssh root@你的服务器IP
```

如果不是 root 用户，命令前加 `sudo`。

更新系统：

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

如果你的服务器只有系统盘，没有单独数据盘，可以跳过本节，直接创建 `/data/newapi`。

### 4.1 查看磁盘

```bash
lsblk
```

常见结果：

```text
vda    50G  系统盘
vdb    50G  数据盘
```

假设数据盘是 `/dev/vdb`。如果你的机器显示为 `/dev/sdb` 或 `/dev/nvme1n1`，后续命令要替换成实际名称。

### 4.2 格式化数据盘

> 注意：这一步会清空数据盘。只对全新的空数据盘执行。

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

编辑：

```bash
vim /etc/fstab
```

末尾加入一行，把 `你的UUID` 换成真实 UUID：

```text
UUID=你的UUID /data ext4 defaults,nofail 0 2
```

验证：

```bash
umount /data
mount -a
df -h
```

能看到 `/data` 即成功。

## 5. 安装 Docker

如果宝塔已经安装了 Docker，可以先检查：

```bash
docker version
docker compose version
```

如果能正常显示版本，跳到第 6 节。

如果没有 Docker，按下面安装。

### 5.1 添加 Docker 官方源

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

### 5.2 安装 Docker 和 Compose 插件

```bash
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

启动并设置开机启动：

```bash
systemctl enable docker
systemctl start docker
```

检查：

```bash
docker version
docker compose version
```

## 6. 创建部署目录

```bash
mkdir -p /data/newapi/app
mkdir -p /data/newapi/storage/postgres
mkdir -p /data/newapi/storage/redis
mkdir -p /data/newapi/storage/data
mkdir -p /data/newapi/storage/logs
mkdir -p /data/newapi/backups
```

## 7. 上传项目代码

你的二开项目代码要放到：

```text
/data/newapi/app
```

### 7.1 如果你有 Git 仓库

```bash
cd /data/newapi
git clone 你的仓库地址 app
cd /data/newapi/app
```

### 7.2 如果从电脑上传

把本地 `D:\newapi` 上传到服务器：

```text
/data/newapi/app
```

不要上传这些：

```text
node_modules
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

应该看到：

```text
Dockerfile
docker-compose.yml
go.mod
main.go
web
```

## 8. 生成强密码

执行三次：

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

分别记录为：

```text
PostgreSQL 密码
Redis 密码
SESSION_SECRET
```

不要使用 `123456`、`password`、`random_string`。

## 9. 编写 Docker Compose

进入项目目录：

```bash
cd /data/newapi/app
```

备份原文件：

```bash
cp docker-compose.yml docker-compose.yml.bak
```

编辑：

```bash
vim docker-compose.yml
```

用下面内容替换。注意把 `你的PostgreSQL强密码`、`你的Redis强密码`、`你的SESSION_SECRET随机字符串` 改掉。

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

检查配置：

```bash
docker compose config
```

如果没有报错，就继续。

## 10. 首次启动

```bash
cd /data/newapi/app
docker compose up -d --build
```

第一次会下载镜像和依赖，可能需要较久。

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f new-api
```

测试：

```bash
curl http://127.0.0.1:3000/api/status
```

能返回 JSON 即说明应用启动成功。

## 11. 宝塔安装 Nginx

因为你现在只装了宝塔，不一定有 Nginx。

在宝塔面板：

1. 软件商店
2. 搜索 `Nginx`
3. 安装 Nginx
4. 安装完成后确认 Nginx 正在运行

不需要安装 PHP、MySQL、phpMyAdmin。

## 12. 宝塔添加网站和反向代理

### 12.1 添加站点

宝塔面板：

1. 网站
2. 添加站点
3. 域名填：

```text
你的域名
```

4. PHP 版本选择“纯静态”或“不使用 PHP”
5. 根目录默认即可

### 12.2 配置反向代理

站点设置 -> 反向代理 -> 添加反向代理：

```text
目标 URL：http://127.0.0.1:3000
发送域名：$host
```

如果宝塔提供高级配置，把下面加入站点 Nginx 配置的 `server {}` 内：

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

重点：

- `proxy_buffering off`：保证流式响应不会卡住
- `proxy_read_timeout 3600s`：避免长回答断开
- `Authorization`：保证 API Key 能传到后端

## 13. 开启 HTTPS

宝塔面板：

1. 网站
2. 选择你的站点
3. SSL
4. Let's Encrypt
5. 申请证书
6. 开启强制 HTTPS

浏览器访问：

```text
https://你的域名
```

## 14. 安全组和防火墙

云服务器安全组只开放：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH |
| 80 | HTTP |
| 443 | HTTPS |
| 宝塔端口 | 面板访问 |

不要开放：

| 端口 | 说明 |
| --- | --- |
| 3000 | new-api 内部端口 |
| 5432 | PostgreSQL |
| 6379 | Redis |

如果使用 UFW：

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 宝塔端口/tcp
ufw enable
ufw status
```

## 15. 初始化平台

打开：

```text
https://你的域名
```

首次进入后建议马上做：

1. 初始化管理员
2. 修改管理员密码
3. 关闭不需要的注册入口
4. 添加模型渠道
5. 配置模型价格
6. 创建 API Key
7. 测试一次接口调用

## 16. 测试 API

替换你的 API Key：

```bash
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "你的模型名",
    "messages": [
      {
        "role": "user",
        "content": "你好"
      }
    ],
    "stream": false
  }'
```

如果返回 `model_not_found`，说明模型渠道没配置好，不是服务器部署问题。

## 17. 日常运维命令

进入目录：

```bash
cd /data/newapi/app
```

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f new-api
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

不要随便执行：

```bash
docker compose down -v
```

## 18. 数据备份

### 18.1 手动备份数据库

```bash
mkdir -p /data/newapi/backups
docker exec new-api-postgres pg_dump -U newapi -d newapi | gzip > /data/newapi/backups/newapi_$(date +%F_%H%M%S).sql.gz
```

### 18.2 自动每日备份

创建脚本：

```bash
vim /data/newapi/backup.sh
```

写入：

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

## 19. 更新二开版本

如果用 Git：

```bash
cd /data/newapi/app
git pull
docker compose up -d --build
```

如果手动上传代码：

1. 上传覆盖 `/data/newapi/app`
2. 不要覆盖 `/data/newapi/storage`
3. 不要覆盖 `/data/newapi/backups`
4. 执行：

```bash
cd /data/newapi/app
docker compose up -d --build
```

## 20. 清理磁盘

查看磁盘：

```bash
df -h
du -sh /data/newapi/*
docker system df
```

清理 Docker 构建缓存：

```bash
docker builder prune
```

清理未使用镜像：

```bash
docker image prune -a
```

配置 Docker 日志轮转：

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
cd /data/newapi/app
docker compose up -d
```

## 21. 常见故障

### 21.1 域名打不开

先在服务器测试：

```bash
curl http://127.0.0.1:3000/api/status
```

如果本机正常，问题在：

- 宝塔 Nginx
- 域名解析
- SSL
- 云服务器安全组

### 21.2 502 Bad Gateway

检查：

```bash
cd /data/newapi/app
docker compose ps
docker compose logs --tail=100 new-api
```

确认宝塔反代目标：

```text
http://127.0.0.1:3000
```

### 21.3 数据库连接失败

检查：

```bash
docker compose logs --tail=100 postgres
docker compose logs --tail=100 new-api
```

重点看：

- `SQL_DSN` 密码是否正确
- `POSTGRES_PASSWORD` 是否一致
- 数据库名是否是 `newapi`
- 用户名是否是 `newapi`

### 21.4 Redis 连接失败

检查：

```bash
docker compose logs --tail=100 redis
docker compose logs --tail=100 new-api
```

连接格式应为：

```text
redis://:你的Redis强密码@redis:6379/0
```

### 21.5 登录后马上掉线

检查：

```bash
docker compose exec new-api env | grep SESSION_SECRET
```

要求：

- 不能为空
- 不能是 `random_string`
- 更新版本时不要随便改

### 21.6 流式输出卡顿或中断

检查宝塔 Nginx 是否有：

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

## 22. 上线检查清单

- [ ] `/data` 数据盘已挂载
- [ ] Docker 可用
- [ ] Docker Compose 可用
- [ ] 项目代码在 `/data/newapi/app`
- [ ] PostgreSQL 密码已改强密码
- [ ] Redis 密码已改强密码
- [ ] `SESSION_SECRET` 已设置
- [ ] `CRYPTO_SECRET` 已设置
- [ ] `127.0.0.1:3000` 可以访问
- [ ] 宝塔已安装 Nginx
- [ ] 宝塔反代到 `127.0.0.1:3000`
- [ ] HTTPS 已开启
- [ ] 3000、5432、6379 没有开放外网
- [ ] 管理员密码已修改
- [ ] 已配置每日备份
- [ ] 已测试 API Key 调用

## 23. 参考资料

- Docker Ubuntu 安装文档：https://docs.docker.com/engine/install/ubuntu/
- Docker Compose Linux 安装文档：https://docs.docker.com/compose/install/linux/
- PostgreSQL Docker 官方镜像：https://hub.docker.com/_/postgres
- Redis Docker 官方镜像：https://hub.docker.com/_/redis

