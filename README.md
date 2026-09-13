# SSH Monitor & Terminal

A modern, web-based SSH terminal and server monitoring dashboard built with Next.js, Tailwind CSS, and MongoDB.

## Features

- 🖥️ **Web-based SSH Terminal**: Full-featured xterm.js terminal with resizing and real-time WebSocket communication.
- 📊 **Dashboard**: Visual overview of your server status (Online/Offline).
- 🔑 **Key Management**: Support for private key (.pem, .ppk) and passwor authentication.
- 🎨 **Modern UI**: Premium dark theme with glassmorphism effects.
- 🏷️ **Organization**: Tag, color code, and search your connections.
- 📁 **File Upload**: Drag-and-drop private keys securely.
- ⚡ **Real-time**: WebSocket-based sessions and live status updates.

## Prerequisites

- **Node.js** (v18 or higher)
- **MongoDB** (Ensure `mongod` is running locally or provide a URI)

## Getting Started

1.  **Install Dependencies**

    ```bash
    npm install
    ```

2.  **Environment Setup**

    Create a `.env` file in the root directory (already created):

    ```ini
    MONGODB_URI=mongodb://localhost:27017/ssh-monitor
    PORT=3030
    ```

3.  **Run Development Server**

    ```bash
    npm run dev
    ```

    > **Note**: This uses a custom `server.js` to handle WebSocket connections for the SSH terminal.

4.  **Open in Browser**

    Navigate to [http://localhost:3030](http://localhost:3030).

## Docker Deployment

This project includes a production-ready Docker setup for the custom `server.js` runtime.

### Files

- `Dockerfile` — multi-stage production image
- `.dockerignore` — smaller, cleaner build context
- `docker-compose.yml` — app + MongoDB deployment config
- `deploy/nginx/monitor.eaqdragon.com.conf` — nginx reverse proxy for the domain

### Server Setup

1. Copy the project to your server.
2. Create or upload your `.env` file.
3. Build and start the containers:

```bash
docker compose up -d --build
```

This starts two services — nginx is a **separate** container and is not defined
in this compose file:

- `monitor` — no host port. Reachable on the `proxy-net` network as `monitor:3030`.
- `monitor-mongo` — `127.0.0.1:27021` on the host, `monitor-mongo:27017` on `proxy-net`

MongoDB credentials used by the app:

- Database: `monitor`
- Username: `monitor`
- Password: `<MONGO_PASSWORD>`

### Updating on Server

After pushing new code to the server:

```bash
docker compose up -d --build
```

### Notes

- The app listens on port `3030` inside the container. `Dockerfile` sets `ENV PORT=3030` and `docker-compose.yml` sets `PORT: 3030`, which overrides `env_file` — this is deliberately **not** Next.js's `3000` default.
- `nginx` runs as its own container on the external `proxy-net` network and proxies to `monitor:3030`; use `deploy/nginx/docker/default.conf` for that.
- `docker-compose.yml` publishes **no** host port for `monitor`, so nginx must share the `proxy-net` network with it. A host nginx cannot reach it as-is — see the header of `deploy/nginx/monitor.eaqdragon.com.conf` for what that topology would require.
- `.env` is injected at runtime via `env_file`, so secrets are not baked into the image.
- `db-config.json` is bind-mounted to `/app/db-config.json` so Settings changes survive container restarts.
- MongoDB data is stored in the Docker volume `mongo_data`.
- MongoDB still listens on `27017` inside Docker, but is exposed as `127.0.0.1:27021` on the host to avoid host port conflicts. It is bound to loopback, never `0.0.0.0`.

### Nginx

For Docker Compose deployments, nginx runs as a container using `deploy/nginx/docker/default.conf`.

If you prefer host-level nginx instead, a host config is included at `deploy/nginx/monitor.eaqdragon.com.conf`.

Typical host-level nginx server steps:

```bash
sudo cp deploy/nginx/monitor.eaqdragon.com.conf /etc/nginx/sites-available/monitor.eaqdragon.com
sudo ln -s /etc/nginx/sites-available/monitor.eaqdragon.com /etc/nginx/sites-enabled/monitor.eaqdragon.com
sudo nginx -t
sudo systemctl reload nginx
```

If you use SSL with Certbot, run it after nginx is live:

```bash
sudo certbot --nginx -d monitor.eaqdragon.com
```

## Usage

1.  Click **"Add Server"** (or "New Connection") to add a new SSH host.
2.  Enter the **Host**, **Port**, **Username**, and choose **Password** or **Private Key**.
3.  Click **Save**.
4.  Double-click the connection in the sidebar or click the **Connect** icon to open a terminal tab.

## Technologies

- **Frontend**: Next.js 14, Tailwind CSS, Lucide Icons, React Hot Toast
- **Backend**: Custom Node.js server (Express-like) with Next.js
- **Database**: MongoDB (Mongoose)
- **SSH/Terminal**: ssh2, socket.io, xterm.js

## License

MIT

# monitor
