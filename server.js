const express = require('express');
const sqlite = require('better-sqlite3');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
const db = new sqlite('database.db');

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// --- Database Initialization ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    avatarColor TEXT,
    isAdmin INTEGER DEFAULT 0,
    phone TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER,
    name TEXT,
    price REAL,
    desc TEXT,
    mediaType TEXT,
    mediaDataURL TEXT,
    createdAt INTEGER,
    FOREIGN KEY(sellerId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    followerId INTEGER,
    followingId INTEGER,
    PRIMARY KEY (followerId, followingId),
    FOREIGN KEY(followerId) REFERENCES users(id),
    FOREIGN KEY(followingId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    userId INTEGER,
    productId INTEGER,
    type TEXT,
    PRIMARY KEY (userId, productId),
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    userId INTEGER,
    productId INTEGER,
    stars INTEGER,
    PRIMARY KEY (userId, productId),
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    productId INTEGER,
    text TEXT,
    createdAt INTEGER,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(productId) REFERENCES products(id)
  );
`);

// Insert default Admin if not exists
const adminExists = db.prepare('SELECT * FROM users WHERE isAdmin = 1').get();
if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('201024', 10);
    db.prepare('INSERT INTO users (username, password, avatarColor, isAdmin, phone) VALUES (?, ?, ?, ?, ?)').run(
        '⭐ المدير', hashedPassword, '#facc15', 1, ''
    );
}

// --- API Endpoints ---

// Auth
app.post('/api/register', (req, res) => {
    const { username, password, avatarColor, phone } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const result = db.prepare('INSERT INTO users (username, password, avatarColor, phone) VALUES (?, ?, ?, ?)').run(
            username, hashedPassword, avatarColor, phone || ''
        );
        res.json({ success: true, userId: result.lastInsertRowid });
    } catch (e) {
        res.status(400).json({ success: false, message: 'Username already exists' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password, adminCode } = req.body;
    
    if (adminCode === '201024') {
        const admin = db.prepare('SELECT * FROM users WHERE isAdmin = 1').get();
        return res.json({ success: true, user: { id: admin.id, username: admin.username, avatarColor: admin.avatarColor, isAdmin: 1, phone: admin.phone } });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user && bcrypt.compareSync(password, user.password)) {
        res.json({ success: true, user: { id: user.id, username: user.username, avatarColor: user.avatarColor, isAdmin: user.isAdmin, phone: user.phone } });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Products
app.get('/api/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products ORDER BY createdAt DESC').all();
    products.forEach(p => {
        p.ratings = db.prepare('SELECT userId, stars FROM ratings WHERE productId = ?').all(p.id);
        p.comments = db.prepare('SELECT * FROM comments WHERE productId = ? ORDER BY createdAt ASC').all(p.id);
    });
    res.json(products);
});

app.post('/api/products', (req, res) => {
    const { sellerId, name, price, desc, mediaType, mediaDataURL } = req.body;
    const result = db.prepare('INSERT INTO products (sellerId, name, price, desc, mediaType, mediaDataURL, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        sellerId, name, price, desc, mediaType, mediaDataURL, Date.now()
    );
    res.json({ success: true, productId: result.lastInsertRowid });
});

app.delete('/api/products/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    db.prepare('DELETE FROM reactions WHERE productId = ?').run(id);
    db.prepare('DELETE FROM ratings WHERE productId = ?').run(id);
    db.prepare('DELETE FROM comments WHERE productId = ?').run(id);
    res.json({ success: true });
});

// Interactions
app.post('/api/products/:id/react', (req, res) => {
    const { id } = req.params;
    const { userId, type } = req.body;
    const existing = db.prepare('SELECT * FROM reactions WHERE userId = ? AND productId = ?').get(userId, id);
    if (existing) {
        if (existing.type === type) {
            db.prepare('DELETE FROM reactions WHERE userId = ? AND productId = ?').run(userId, id);
        } else {
            db.prepare('UPDATE reactions SET type = ? WHERE userId = ? AND productId = ?').run(type, userId, id);
        }
    } else {
        db.prepare('INSERT INTO reactions (userId, productId, type) VALUES (?, ?, ?)').run(userId, id, type);
    }
    res.json({ success: true });
});

app.get('/api/reactions/:productId', (req, res) => {
    const reactions = db.prepare('SELECT * FROM reactions WHERE productId = ?').all(req.params.productId);
    res.json(reactions);
});

app.post('/api/products/:id/rate', (req, res) => {
    const { id } = req.params;
    const { userId, stars } = req.body;
    const existing = db.prepare('SELECT * FROM ratings WHERE userId = ? AND productId = ?').get(userId, id);
    if (existing) {
        db.prepare('UPDATE ratings SET stars = ? WHERE userId = ? AND productId = ?').run(stars, userId, id);
    } else {
        db.prepare('INSERT INTO ratings (userId, productId, stars) VALUES (?, ?, ?)').run(userId, id, stars);
    }
    res.json({ success: true });
});

app.post('/api/products/:id/comment', (req, res) => {
    const { id } = req.params;
    const { userId, text } = req.body;
    db.prepare('INSERT INTO comments (userId, productId, text, createdAt) VALUES (?, ?, ?, ?)').run(
        userId, id, text, Date.now()
    );
    res.json({ success: true });
});

app.delete('/api/comments/:id', (req, res) => {
    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Follows
app.get('/api/follows', (req, res) => {
    const follows = db.prepare('SELECT * FROM follows').all();
    res.json(follows);
});

app.post('/api/follow', (req, res) => {
    const { followerId, followingId } = req.body;
    try {
        db.prepare('INSERT INTO follows (followerId, followingId) VALUES (?, ?)').run(followerId, followingId);
        res.json({ success: true });
    } catch (e) {
        db.prepare('DELETE FROM follows WHERE followerId = ? AND followingId = ?').run(followerId, followingId);
        res.json({ success: true, removed: true });
    }
});

// Users
app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT id, username, avatarColor, isAdmin, phone FROM users').all();
    res.json(users);
});

app.put('/api/users/:id/phone', (req, res) => {
    const { id } = req.params;
    const { phone } = req.body;
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, id);
    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
