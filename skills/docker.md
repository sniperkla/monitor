---
name: docker
keywords: [docker, container, image, dockerfile, docker-compose, dind]
primary_keywords: [docker, dockerfile, docker compose, docker-compose]
---

# Docker Management Skill

## Description
Expert at managing Docker containers, images, volumes, and networks.

## Detection
```bash
command -v docker && docker --version
```

## Container Management
- List running: `docker ps`
- List all: `docker ps -a`
- Start: `docker start CONTAINER`
- Stop: `docker stop CONTAINER`
- Restart: `docker restart CONTAINER`
- Remove: `docker rm -f CONTAINER`
- Logs: `docker logs CONTAINER --tail 100 -f`
- Execute: `docker exec -it CONTAINER bash`
- Copy file: `docker cp local_file CONTAINER:/path/`

## Image Management
- List images: `docker images`
- Pull: `docker pull IMAGE:TAG`
- Build: `docker build -t NAME:TAG .`
- Remove: `docker rmi IMAGE`
- Prune unused: `docker image prune -a`
- Tag: `docker tag OLD NEW`

## Volume Management
- List: `docker volume ls`
- Create: `docker volume create NAME`
- Remove: `docker volume rm NAME`
- Prune: `docker volume prune`

## Network Management
- List: `docker network ls`
- Create: `docker network create NAME`
- Inspect: `docker network inspect NAME`
- Connect: `docker network connect NETWORK CONTAINER`

## Docker Compose
- Up: `docker-compose up -d` or `docker compose up -d`
- Down: `docker-compose down`
- Logs: `docker-compose logs -f SERVICE`
- Build: `docker-compose build`
- Ps: `docker-compose ps`

## System Cleanup
- Disk usage: `docker system df`
- Prune all: `docker system prune -a --volumes`
- Remove stopped containers: `docker container prune`

## Common Issues
- Permission denied: Add user to docker group: `sudo usermod -aG docker $USER`
- No space left: `docker system prune -a`
- Container won't start: Check logs with `docker logs CONTAINER`
- Port in use: Check with `ss -tlnp | grep PORT`
