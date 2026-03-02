# Database Management Skill

## Description
Expert at managing MySQL/MariaDB, PostgreSQL, MongoDB, and Redis databases.

## MySQL/MariaDB

### Detection
```bash
command -v mysql && mysql --version
```

### Service Management
- Status: `systemctl status mysql` or `systemctl status mariadb`
- Start: `systemctl start mysql`
- Stop: `systemctl stop mysql`
- Restart: `systemctl restart mysql`

### Common Commands
- Login: `mysql -u root -p`
- Login with host: `mysql -u user -p -h localhost`
- Create database: `CREATE DATABASE dbname;`
- Create user: `CREATE USER 'user'@'localhost' IDENTIFIED BY 'password';`
- Grant permissions: `GRANT ALL PRIVILEGES ON dbname.* TO 'user'@'localhost';`
- Flush privileges: `FLUSH PRIVILEGES;`
- Show databases: `SHOW DATABASES;`
- Show users: `SELECT user, host FROM mysql.user;`

### Backup & Restore
- Backup all: `mysqldump -u root -p --all-databases > backup.sql`
- Backup single: `mysqldump -u root -p dbname > dbname.sql`
- Backup with gzip: `mysqldump -u root -p dbname | gzip > dbname.sql.gz`
- Restore: `mysql -u root -p dbname < backup.sql`
- Restore from gzip: `gunzip < dbname.sql.gz | mysql -u root -p dbname`

### Performance
- Show processes: `SHOW PROCESSLIST;`
- Kill process: `KILL PROCESS_ID;`
- Show status: `SHOW STATUS;`
- Show variables: `SHOW VARIABLES LIKE '%innodb%';`

## PostgreSQL

### Detection
```bash
command -v psql && psql --version
```

### Service Management
- Status: `systemctl status postgresql`
- Start: `systemctl start postgresql`
- Stop: `systemctl stop postgresql`

### Common Commands
- Login: `sudo -u postgres psql`
- Create database: `CREATE DATABASE dbname;`
- Create user: `CREATE USER user WITH PASSWORD 'password';`
- Grant permissions: `GRANT ALL PRIVILEGES ON DATABASE dbname TO user;`
- List databases: `\l`
- List users: `\du`
- Connect to db: `\c dbname`
- Quit: `\q`

### Backup & Restore
- Backup: `pg_dump dbname > backup.sql`
- Backup with gzip: `pg_dump dbname | gzip > backup.sql.gz`
- Backup all: `pg_dumpall > all_databases.sql`
- Restore: `psql dbname < backup.sql`

## MongoDB

### Detection
```bash
command -v mongod && mongod --version
```

### Service Management
- Status: `systemctl status mongod`
- Start: `systemctl start mongod`
- Stop: `systemctl stop mongod`

### Common Commands
- Login: `mongosh` or `mongo`
- Show databases: `show dbs`
- Use database: `use dbname`
- Show collections: `show collections`
- Create user: `db.createUser({user: "admin", pwd: "password", roles: ["root"]})`
- Find all: `db.collection.find()`
- Insert: `db.collection.insertOne({key: "value"})`

### Backup & Restore
- Backup: `mongodump --db dbname --out /backup/`
- Restore: `mongorestore --db dbname /backup/dbname/`

## Redis

### Detection
```bash
command -v redis-server && redis-server --version
```

### Service Management
- Status: `systemctl status redis`
- Start: `systemctl start redis`
- Stop: `systemctl stop redis`

### Common Commands
- Login: `redis-cli`
- Get value: `GET key`
- Set value: `SET key value`
- Set with expiry: `SETEX key 3600 value`
- Delete key: `DEL key`
- List keys: `KEYS *`
- Flush all: `FLUSHALL`
- Info: `INFO`

### Backup
- Save: `redis-cli BGSAVE`
- RDB location: `/var/lib/redis/dump.rdb`
