const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());

// ================= สร้างโฟลเดอร์เก็บรูป (ถ้ายังไม่มี) =================
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}
app.use('/uploads', express.static('uploads'));

// ================= ตั้งค่าระบบอัปโหลดไฟล์ (Multer) =================
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)); }
});
// 🟢 ตั้งค่าระบบอัปโหลดรูป พร้อมจำกัดขนาดสูงสุด 5MB
const upload = multer({ 
  dest: 'uploads/',
  limits: { 
    fileSize: 5 * 1024 * 1024 // 5 MB (คำนวณเป็นหน่วย Byte)
  },
  fileFilter: (req, file, cb) => {
    // ยอมรับเฉพาะไฟล์รูปภาพเท่านั้น ป้องกันคนอัปโหลดไฟล์ไวรัส (.exe, .php)
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('กรุณาอัปโหลดเฉพาะไฟล์รูปภาพเท่านั้นครับ!'));
    }
  }
});

// ================= DB SETUP =================
// 🟢 รองรับการเชื่อมต่อทั้งบนเครื่องตัวเอง (localhost) และบนเซิร์ฟเวอร์จริง
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'shop_db'
});

// ================= API ROUTES =================
app.get('/products', (req, res) => {
  const cat = req.query.cat;
  const search = req.query.search;
  const sort = req.query.sort; // รับคำสั่งเรียงลำดับ
  
  let sql = "SELECT * FROM products WHERE 1=1";
  let params = [];

  if (cat && cat !== 'all') {
    sql += " AND category = ?";
    params.push(cat);
  }

  if (search) {
    sql += " AND name LIKE ?";
    params.push('%' + search + '%'); 
  }
  
  // จัดเรียงสินค้าตามที่ลูกค้าเลือก
  if (sort === 'price_asc') {
    sql += " ORDER BY price ASC"; // ราคาถูกไปแพง
  } else if (sort === 'price_desc') {
    sql += " ORDER BY price DESC"; // ราคาแพงไปถูก
  } else {
    sql += " ORDER BY id DESC"; // ค่าเริ่มต้น: สินค้าใหม่ล่าสุด
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results || []);
  });
});

app.post('/products', (req, res) => {
  const { name, price, image, stock, category } = req.body;
  db.query("INSERT INTO products (name, price, image, stock, category) VALUES (?, ?, ?, ?, ?)", 
  [name, Number(price), image, Number(stock), category || 'all'], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
app.delete('/products/:id', (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    const hash = await bcrypt.hash(password, 10);
    db.query("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], (err) => {
      if (err) return res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว!' });
      res.json({ success: true });
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', (req, res) => {
  try {
    db.query("SELECT * FROM users WHERE username = ?", [req.body.username], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!results || results.length === 0) return res.status(400).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ' });
      const match = await bcrypt.compare(req.body.password, results[0].password);
      if (!match) return res.status(400).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
      res.json({ success: true, user: { id: results[0].id, username: results[0].username, role: results[0].role } });
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/checkout', upload.single('slip_image'), (req, res) => {
  try {
    // รับค่า address เพิ่มเข้ามา
    const { user_id, username, cart_data, total_price, address } = req.body;
    const slip_image = req.file ? '/uploads/' + req.file.filename : null;
    
    if (!address) return res.status(400).json({ error: 'กรุณากรอกที่อยู่จัดส่งด้วยครับ!' });
    if (!slip_image) return res.status(400).json({ error: 'กรุณาแนบรูปภาพสลิปโอนเงินด้วยครับ!' });

    // เพิ่ม shipping_address ลงในคำสั่ง SQL
    db.query("INSERT INTO orders (user_id, username, cart_data, total_price, shipping_address, slip_image) VALUES (?, ?, ?, ?, ?, ?)", 
    [user_id, username, cart_data, total_price, address, slip_image], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      try {
        const cartItems = JSON.parse(cart_data);
        cartItems.forEach(item => {
          const qty = item.qty || 1;
          db.query("UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?", [qty, item.id]);
        });
      } catch (parseErr) { console.error("Parse Cart Error:", parseErr); }

      res.json({ success: true });
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// ดึงข้อมูลสถิติสำหรับ Dashboard
app.get('/api/admin/dashboard', (req, res) => {
  db.query("SELECT SUM(total_price) as sales FROM orders WHERE status IN ('approved', 'shipped')", (err1, r1) => {
    db.query("SELECT COUNT(*) as pending FROM orders WHERE status = 'pending'", (err2, r2) => {
      db.query("SELECT COUNT(*) as outOfStock FROM products WHERE stock <= 0", (err3, r3) => {
         res.json({
           sales: r1[0].sales || 0,
           pending: r2[0].pending || 0,
           outOfStock: r3[0].outOfStock || 0
         });
      });
    });
  });
});
app.get('/api/orders', (req, res) => {
  db.query("SELECT * FROM orders ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results || []);
  });
});

app.put('/api/orders/:id', (req, res) => {
  db.query("UPDATE orders SET status = 'approved' WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
// ดึงประวัติออเดอร์ของลูกค้าแต่ละคน
app.get('/api/my-orders/:userId', (req, res) => {
  db.query("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results || []);
  });
});

// แอดมินกดแจ้งจัดส่งพร้อมใส่เลขพัสดุ
app.put('/api/orders/:id/ship', (req, res) => {
  const { tracking } = req.body;
  db.query("UPDATE orders SET status = 'shipped', tracking_number = ? WHERE id = ?", [tracking, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================= HOME PAGE =================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>Caseme | เคสมือถือพรีเมียม</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <style>
    body { font-family: 'Kanit', sans-serif; background: #f4f6f9; }
    .navbar { background: rgba(255, 255, 255, 0.85) !important; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.03); }
    .brand { font-weight: 800; font-size: 1.6rem; text-decoration: none; color: #111; letter-spacing: -0.5px; }
    .brand span { color: #007bff; font-weight: 400; }
    .fade-in { animation: fadeIn 0.6s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .product-card { border: none; border-radius: 20px; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); background: white; }
    .product-card:hover { transform: translateY(-8px); box-shadow: 0 15px 30px rgba(0,0,0,0.1); }
    .product-card img { height: 220px; object-fit: cover; border-radius: 20px 20px 0 0; transition: 0.5s; }
    .product-card:hover img { transform: scale(1.03); }
    .btn { transition: all 0.3s; border-radius: 30px; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
    .cart-box { border-radius: 24px; border: 1px solid rgba(0,0,0,0.05); }
    /* สไตล์สำหรับแถบเมนูสีดำ */
    .black-nav { background-color: #111; }
    .black-nav .nav-link { 
      color: rgba(255,255,255,0.8); 
      font-size: 0.95rem; 
      padding: 12px 20px; 
      transition: all 0.3s; 
    }
    .black-nav .nav-link:hover { color: #fff; background-color: rgba(255,255,255,0.1); }
    .black-nav .sale-link { color: #ff4757 !important; font-weight: bold; }
    .black-nav .sale-link:hover { background-color: rgba(255, 71, 87, 0.1); }
  </style>
</head>
<body>
<nav class="navbar py-3 sticky-top">
  <div class="container d-flex justify-content-between align-items-center flex-wrap">
    <a href="/" class="brand mb-2 mb-md-0"><i class="bi bi-phone me-1"></i>Case<span>me.</span></a>
    
    <div class="input-group mx-md-3 mb-2 mb-md-0" style="max-width: 400px; flex: 1;">
      <input type="text" id="searchInput" class="form-control bg-light border-0" placeholder="พิมพ์ชื่อสินค้า, รุ่นมือถือ..." onkeyup="if(event.key === 'Enter') searchProduct()">
      <button class="btn btn-primary px-3" onclick="searchProduct()"><i class="bi bi-search"></i></button>
    </div>
    <div id="nav-auth"><a href="/login" class="btn btn-dark btn-sm px-4 fw-medium">เข้าสู่ระบบ</a></div>
  </div>
</nav>
<div class="black-nav d-none d-md-block">
  <div class="container">
    <ul class="nav justify-content-center fw-medium">
  <li class="nav-item"><a href="javascript:load('all')" class="nav-link"><i class="bi bi-star me-1"></i> ทั้งหมด</a></li>
  <li class="nav-item"><a href="javascript:load('iphone')" class="nav-link">iPhone</a></li>
  <li class="nav-item"><a href="javascript:load('samsung')" class="nav-link">Samsung</a></li>
  <li class="nav-item"><a href="javascript:load('oppovivo')" class="nav-link">OPPO / Vivo</a></li>
  <li class="nav-item"><a href="javascript:load('transparent')" class="nav-link">เคสใส</a></li>
  <li class="nav-item"><a href="javascript:load('shockproof')" class="nav-link">เคสกันกระแทก</a></li>
</ul>
  </div>
</div>

<div class="bg-dark text-white text-center py-5 mb-5" style="background: linear-gradient(135deg, #111, #333); border-radius: 0 0 40px 40px;">
  <div class="container py-4 fade-in">
    <h1 class="display-4 fw-bold mb-3">ปกป้องสมาร์ทโฟนของคุณ<br>ด้วยสไตล์ที่โดดเด่น</h1>
    <p class="lead text-light mb-4 opacity-75">เคสมือถือพรีเมียม ดีไซน์มินิมอล กันกระแทกขั้นสุด จัดส่งฟรีทั่วประเทศ</p>
    <a href="#products-section" class="btn btn-primary btn-lg px-5 rounded-pill shadow">ช้อปเลยตอนนี้</a>
  </div>
</div>

<div class="container mb-5 fade-in" id="products-section">
  <div class="d-flex justify-content-between align-items-end mb-4 border-bottom pb-3 flex-wrap gap-3">
    <h3 class="fw-bold mb-0">🔥 สินค้าของเรา</h3>
    <select id="sortInput" class="form-select form-select-sm w-auto bg-light border-0 fw-medium" onchange="searchProduct()">
      <option value="newest">✨ สินค้าอัปเดตล่าสุด</option>
      <option value="price_asc">📈 ราคา: ต่ำ ไป สูง</option>
      <option value="price_desc">📉 ราคา: สูง ไป ต่ำ</option>
    </select>
  </div>
  <div class="row g-4" id="products"></div>
  
  <div class="mt-5 p-4 p-md-5 bg-white shadow-sm cart-box" id="cart-box">
    <h4 class="fw-bold mb-4"><i class="bi bi-bag-check me-2"></i>ตะกร้าสินค้า</h4>
    <div id="cart-list" class="mb-4"></div>
    <div class="d-flex justify-content-between align-items-center bg-light p-4 rounded-4">
      <span class="fs-5 text-muted fw-medium">รวมค่าสินค้า</span>
      <h2 class="mb-0 fw-bold text-dark"><span id="total-price">0</span> <small class="fs-5">฿</small></h2>
    </div>
    <button class="btn btn-dark w-100 py-3 mt-4 fw-bold fs-5" onclick="showPayment()">ดำเนินการสั่งซื้อ</button>
  </div>
</div>

<footer class="bg-white border-top py-5 mt-5">
  <div class="container">
    <div class="row text-center text-md-start">
      <div class="col-md-4 mb-4 mb-md-0">
        <h4 class="fw-bold mb-3">Case<span class="text-primary">me.</span></h4>
        <p class="text-muted small mb-4">เราคัดสรรเคสที่ดีที่สุด เพื่อปกป้องมือถือที่คุณรัก ดีไซน์พรีเมียม กันกระแทกขั้นสุด พร้อมบริการจัดส่งฟรีทั่วประเทศ</p>
      </div>
      <div class="col-md-4 mb-4 mb-md-0 text-center">
        <h6 class="fw-bold mb-3">📞 ติดต่อสอบถาม</h6>
        <p class="text-muted small mb-1"><i class="bi bi-telephone me-2"></i>061-390-5323</p>
        <p class="text-muted small mb-1"><i class="bi bi-line text-success me-2"></i>@casemeshop</p>
        <p class="text-muted small mb-1"><i class="bi bi-geo-alt text-danger me-2"></i>ปทุมธานี, ประเทศไทย</p>
      </div>
      <div class="col-md-4 text-center text-md-end">
        <h6 class="fw-bold mb-3">ติดตามเรา</h6>
        <a href="#" class="btn btn-outline-primary btn-sm rounded-circle me-2"><i class="bi bi-facebook"></i></a>
        <a href="#" class="btn btn-outline-success btn-sm rounded-circle me-2"><i class="bi bi-line"></i></a>
        <a href="#" class="btn btn-outline-danger btn-sm rounded-circle"><i class="bi bi-instagram"></i></a>
      </div>
    </div>
    <div class="text-center mt-4 pt-4 border-top text-muted small">
      &copy; 2026 Caseme Shop. All rights reserved.
    </div>
  </div>
</footer>

<script>
let cart = []; 
let products = [];
let currentCat = 'all'; 

function searchProduct() {
  const keyword = document.getElementById('searchInput').value;
  const sort = document.getElementById('sortInput') ? document.getElementById('sortInput').value : 'newest';
  load(currentCat, keyword, sort);
}

function load(cat = 'all', keyword = '', sort = 'newest') {
  currentCat = cat;
  
  let url = '/products?cat=' + cat;
  if(keyword) url += '&search=' + encodeURIComponent(keyword);
  if(sort) url += '&sort=' + sort; // แนบค่าการจัดเรียงไปที่ Backend

  fetch(url).then(r => r.json()).then(data => {
    if(data.error) return console.error(data.error);
    products = data;
    let html = '';
    
    if(data.length === 0) {
       let emptyMsg = keyword ? 'ไม่พบสินค้าคำว่า "' + keyword + '"' : 'ยังไม่มีสินค้าในหมวดหมู่นี้';
       document.getElementById('products').innerHTML = '<div class="col-12 text-center py-5 text-muted"><h5><i class="bi bi-search d-block fs-1 mb-3"></i>' + emptyMsg + '</h5></div>';
       return;
    }

    data.forEach(p => {
      let isOutOfStock = p.stock <= 0;
      let btnClass = isOutOfStock ? 'btn-secondary disabled' : 'btn-dark';
      let btnText = isOutOfStock ? 'สินค้าหมด' : '<i class="bi bi-cart-plus me-1"></i> ใส่ตะกร้า';

      html += '<div class="col-md-4"><div class="card product-card h-100">';
      html += '<div style="overflow:hidden; border-radius:20px 20px 0 0; cursor:pointer;" onclick="viewImage(' + p.id + ')">';
      html += '<img src="' + p.image + '" class="card-img-top"></div>';
      html += '<div class="card-body text-center p-4 d-flex flex-column">';
      html += '<h5 class="fw-bold mb-2" style="cursor:pointer;" onclick="viewImage(' + p.id + ')">' + p.name + '</h5>';
      html += '<h5 class="text-primary fw-bold mb-2">' + p.price + ' ฿</h5>';
      
      let stockTextClass = isOutOfStock ? 'text-danger' : 'text-muted';
      html += '<p class="' + stockTextClass + ' small mb-4">คงเหลือ: ' + p.stock + ' ชิ้น</p>';

      html += '<button class="btn ' + btnClass + ' w-100 mt-auto py-2" ' + (isOutOfStock ? '' : 'onclick="add(' + p.id + ')"') + '>' + btnText + '</button>';
      html += '</div></div></div>';
    });
    document.getElementById('products').innerHTML = html;
  });
}

// 🟢 ระบบ 3: ฟังก์ชัน Popup ดูรูปขยาย
function viewImage(id) {
  const p = products.find(x => x.id === id);
  Swal.fire({
    title: p.name,
    imageUrl: p.image,
    imageWidth: 400,
    imageAlt: p.name,
    html: '<h3 class="text-danger fw-bold mt-2">' + p.price + ' ฿</h3><p class="text-muted mb-0">มีสินค้าในคลัง: ' + p.stock + ' ชิ้น</p>',
    confirmButtonText: 'ปิด',
    confirmButtonColor: '#111',
    showCancelButton: p.stock > 0,
    cancelButtonText: '<i class="bi bi-cart-plus me-1"></i> เพิ่มลงตะกร้า',
    cancelButtonColor: '#0d6efd'
  }).then((result) => {
    // ถ้ายูสเซอร์กดปุ่ม "เพิ่มลงตะกร้า" ใน Popup
    if (result.dismiss === Swal.DismissReason.cancel) { add(p.id); }
  });
}

// 🟢 ระบบ 2: อัปเกรดการเพิ่มสินค้า (ยุบรวมรายการซ้ำ)
function add(id) { 
  const p = products.find(x => x.id === id); 
  let cartItem = cart.find(item => item.id === id); // หาว่ามีสินค้านี้ในตะกร้าหรือยัง

  if (cartItem) {
    // ถ้ามีแล้ว ให้เช็คสต็อกก่อนบวกเพิ่ม
    if (cartItem.qty >= p.stock) return Swal.fire('ขออภัย!', 'คุณเพิ่มสินค้านี้ถึงขีดจำกัดสต็อกแล้ว', 'warning');
    cartItem.qty++; // บวกจำนวนชิ้นเพิ่ม
  } else {
    // ถ้ายังไม่มี ให้ใส่ตะกร้าพร้อมกำหนดจำนวน (qty) เป็น 1
    cart.push({ id: p.id, name: p.name, price: p.price, stock: p.stock, qty: 1 }); 
  }

  render(); 
  Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'เพิ่ม ' + p.name + ' ลงตะกร้าแล้ว', showConfirmButton: false, timer: 1500});
}

// 🟢 ฟังก์ชันใหม่: เพิ่ม/ลด จำนวนสินค้าในตะกร้า
function updateQty(id, change) {
  let item = cart.find(x => x.id === id);
  if (!item) return;
  
  // ป้องกันการกดเพิ่มเกินสต็อก
  if (change > 0 && item.qty >= item.stock) return Swal.fire('ขออภัย!', 'สินค้าหมดสต็อกแล้ว', 'warning');
  
  item.qty += change;
  if (item.qty <= 0) {
    cart = cart.filter(x => x.id !== id); // ถ้าจำนวนเหลือ 0 ให้ลบออกจากตะกร้า
  }
  render();
}

// 🟢 อัปเดตตะกร้าให้แสดงปุ่ม + / -
function render() {
  const list = document.getElementById('cart-list');
  if(cart.length === 0) list.innerHTML = '<div class="text-center py-4 text-muted"><i class="bi bi-cart-x fs-1 d-block mb-2"></i>ยังไม่มีสินค้าในตะกร้า</div>';
  else {
    let html = '';
    cart.forEach((i, idx) => {
      let itemTotal = Number(i.price) * i.qty; // ราคารวมต่อรายการ
      html += '<div class="d-flex justify-content-between align-items-center border-bottom py-3">';
      html += '<div class="fw-medium">' + i.name + '</div>';
      html += '<div class="d-flex align-items-center">';
      
      // ปุ่มลดจำนวน (-)
      html += '<button class="btn btn-sm btn-light px-2 border" onclick="updateQty(' + i.id + ', -1)"><i class="bi bi-dash"></i></button>';
      html += '<span class="mx-2 fw-bold" style="width:20px; text-align:center;">' + i.qty + '</span>';
      // ปุ่มเพิ่มจำนวน (+)
      html += '<button class="btn btn-sm btn-light px-2 border me-3" onclick="updateQty(' + i.id + ', 1)"><i class="bi bi-plus"></i></button>';
      
      html += '<span class="fw-bold me-3 text-primary" style="width:60px; text-align:right;">' + itemTotal + ' ฿</span>';
      html += '<button class="btn btn-sm btn-outline-danger px-2 py-1" onclick="cart.splice(' + idx + ',1);render()"><i class="bi bi-trash3"></i></button>';
      html += '</div></div>';
    });
    list.innerHTML = html;
  }
  
  // คำนวณยอดรวมทั้งหมด (เอา ราคา * จำนวน ของทุกชิ้นมารวมกัน)
  const grandTotal = cart.reduce((sum, item) => sum + (Number(item.price) * item.qty), 0);
  document.getElementById('total-price').innerText = grandTotal;
}

function showPayment() {
  const user = JSON.parse(localStorage.getItem('user'));
  if(!user) return Swal.fire('เข้าสู่ระบบก่อน', 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อสินค้าครับ', 'info').then(()=> location.href = '/login');
  if(!cart.length) return Swal.fire('ตะกร้าว่างเปล่า!', 'กรุณาเลือกสินค้าลงตะกร้าก่อนครับ', 'warning');
  
  const total = document.getElementById('total-price').innerText;
  
  // ดึงที่อยู่เก่าที่เคยพิมพ์ไว้มาแสดง (ถ้ามี)
  const savedAddress = localStorage.getItem('saved_address') || '';
  
  let html = '<div class="text-center fade-in">';
  html += '<h4 class="fw-bold mb-3 text-primary">ยอดชำระ: ' + total + ' ฿</h4>';
  html += '<div class="bg-light p-3 rounded-4 d-inline-block mb-3"><img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=CasemePay" width="150"><p class="mt-2 mb-0 small fw-bold">สแกนเพื่อโอนเงิน</p></div>';
  
  // 🟢 เพิ่มช่องกรอกที่อยู่ตรงนี้ 🟢
  html += '<div class="mb-3 text-start">';
  html += '<label class="form-label fw-bold text-dark"><i class="bi bi-geo-alt-fill me-1 text-danger"></i>ที่อยู่สำหรับจัดส่ง</label>';
  html += '<textarea id="shippingAddress" class="form-control bg-light" rows="3" placeholder="บ้านเลขที่, ซอย, ถนน, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์...">' + savedAddress + '</textarea>';
  html += '</div>';

  html += '<div class="mb-4 text-start">';
  html += '<label class="form-label fw-bold">แนบรูปภาพสลิปโอนเงิน</label>';
  html += '<input type="file" id="slipFile" class="form-control bg-light" accept="image/*">';
  html += '</div>';
  html += '<button class="btn btn-success w-100 py-3 fw-bold fs-5" onclick="confirmPay(' + total + ')"><i class="bi bi-check-circle me-1"></i> ยืนยันการโอนเงิน</button>';
  html += '<button class="btn btn-link text-muted w-100 mt-2" onclick="location.reload()">ยกเลิก</button>';
  html += '</div>';
  document.getElementById('cart-box').innerHTML = html;
}

function confirmPay(total) {
  const fileInput = document.getElementById('slipFile');
  const addressInput = document.getElementById('shippingAddress').value.trim(); // ดึงค่าที่อยู่
  const user = JSON.parse(localStorage.getItem('user'));
  
  if(!addressInput) return Swal.fire('ข้อมูลไม่ครบ!', 'กรุณากรอกที่อยู่สำหรับจัดส่งสินค้าด้วยครับ', 'warning');
  if(fileInput.files.length === 0) return Swal.fire('ลืมแนบสลิป!', 'กรุณาอัปโหลดรูปสลิปโอนเงินด้วยครับ', 'error');

  // บันทึกที่อยู่ไว้ในเครื่องลูกค้า คราวหน้าจะได้ไม่ต้องพิมพ์ใหม่
  localStorage.setItem('saved_address', addressInput);

  Swal.fire({ title: 'กำลังทำรายการ...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

  const formData = new FormData();
  formData.append('user_id', user.id);
  formData.append('username', user.username);
  formData.append('cart_data', JSON.stringify(cart));
  formData.append('total_price', total);
  formData.append('address', addressInput); // ส่งที่อยู่ไป Backend
  formData.append('slip_image', fileInput.files[0]);

  fetch('/api/checkout', { method: 'POST', body: formData })
  .then(r => r.json()).then(data => { 
    if(data.error) return Swal.fire('เกิดข้อผิดพลาด', data.error, 'error');
    Swal.fire('สั่งซื้อสำเร็จ! 🎉', 'ระบบทำการตัดสต็อกและบันทึกข้อมูลเรียบร้อยแล้ว', 'success').then(() => location.reload()); 
  });
}

const user = JSON.parse(localStorage.getItem('user'));
if(user) {
  let navHtml = '<span class="me-3 fw-medium">สวัสดี, ' + user.username + '</span>';
  if(String(user.role).toLowerCase() === 'admin') {
    navHtml += '<a href="/admin" class="btn btn-primary btn-sm px-3 shadow-sm"><i class="bi bi-shield-lock me-1"></i>จัดการร้าน</a>';
  }
  // เพิ่มปุ่ม "ออเดอร์ของฉัน" ตรงนี้
  navHtml += '<button onclick="showMyOrders()" class="btn btn-outline-dark btn-sm px-3 ms-2"><i class="bi bi-box-seam me-1"></i>ออเดอร์ของฉัน</button>';
  navHtml += '<button onclick="localStorage.clear();location.reload()" class="btn btn-outline-danger btn-sm px-3 ms-2">ออก</button>';
  document.getElementById('nav-auth').innerHTML = navHtml;
}
load();
function showMyOrders() {
  const user = JSON.parse(localStorage.getItem('user'));
  if(!user) return Swal.fire('แจ้งเตือน', 'กรุณาเข้าสู่ระบบก่อน', 'warning');

  fetch('/api/my-orders/' + user.id).then(r=>r.json()).then(orders => {
    if(orders.length === 0) return Swal.fire('ประวัติสั่งซื้อ', 'คุณยังไม่มีออเดอร์ครับ แวะดูสินค้าก่อนได้นะ', 'info');

    let html = '<div class="text-start" style="max-height: 60vh; overflow-y: auto; overflow-x: hidden;">';
    orders.forEach(o => {
       let statusHtml = '';
       if(o.status === 'pending') statusHtml = '<span class="badge bg-warning text-dark px-2 py-1">รอตรวจสอบสลิป</span>';
       else if(o.status === 'approved') statusHtml = '<span class="badge bg-info text-dark px-2 py-1">กำลังเตรียมจัดส่ง</span>';
       else if(o.status === 'shipped') statusHtml = '<span class="badge bg-success px-2 py-1"><i class="bi bi-truck me-1"></i>จัดส่งแล้ว</span><div class="mt-2 text-muted small bg-white p-2 rounded border">เลขพัสดุ: <b class="text-dark user-select-all">' + o.tracking_number + '</b></div>';

       // ดึงชื่อสินค้าจาก cart_data
       let productNames = 'สินค้า';
       try {
         let cartItems = JSON.parse(o.cart_data);
         productNames = cartItems.map(i => i.name).join(', '); // นำชื่อสินค้ามาต่อกันด้วยลูกน้ำ
       } catch(e) {}

       html += '<div class="border p-3 rounded-4 mb-3 bg-light shadow-sm">' +
                  '<div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">' +
                    '<div>' +
                      '<div class="fw-bold text-primary mb-1">' + productNames + '</div>' +
                      '<small class="text-muted">ออเดอร์ #' + o.id + '</small>' +
                    '</div>' +
                    '<div>' + statusHtml + '</div>' +
                  '</div>' +
                  '<div class="d-flex justify-content-between align-items-center mt-2">' +
                    '<span class="text-muted small">ยอดชำระ:</span>' +
                    '<span class="text-danger fw-bold fs-5">' + o.total_price + ' ฿</span>' +
                  '</div>' +
                '</div>';
    });
    html += '</div>';

    Swal.fire({
      title: '📦 ออเดอร์ของฉัน',
      html: html,
      width: '500px',
      showConfirmButton: true,
      confirmButtonText: 'ปิดหน้าต่าง',
      confirmButtonColor: '#111'
    });
  });
}
</script>
</body></html>
  `);
});

// ================= LOGIN PAGE =================
app.get('/login', (req, res) => {
  res.send(`
<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>เข้าสู่ระบบ | Caseme</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script><style>body{font-family:'Kanit';background:#f4f6f9;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{border-radius:24px;padding:40px;width:100%;max-width:400px;box-shadow:0 15px 35px rgba(0,0,0,0.05);}.form-control{border-radius:12px;padding:12px 15px;background:#f8f9fa;}.btn-dark{border-radius:12px;}.nav-pills .nav-link{border-radius:12px;color:#666;}.nav-pills .nav-link.active{background:#111;color:#fff;}</style></head><body>
<div class="card border-0">
  <h2 class="text-center fw-bold mb-4">Case<span class="text-primary">me.</span></h2>
  <ul class="nav nav-pills nav-justified mb-4"><li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#login" type="button">เข้าสู่ระบบ</button></li><li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#reg" type="button">สมัครสมาชิก</button></li></ul>
  <div class="tab-content">
    <div class="tab-pane fade show active" id="login"><form id="loginF"><input type="text" id="lu" class="form-control mb-3" placeholder="ชื่อผู้ใช้งาน" required><input type="password" id="lp" class="form-control mb-4" placeholder="รหัสผ่าน" required><button class="btn btn-dark w-100 py-2 fw-bold">เข้าสู่ระบบ</button></form></div>
    <div class="tab-pane fade" id="reg"><form id="regF"><input type="text" id="ru" class="form-control mb-3" placeholder="ตั้งชื่อผู้ใช้งาน" required><input type="password" id="rp" class="form-control mb-4" placeholder="ตั้งรหัสผ่าน" required><button class="btn btn-primary w-100 py-2 fw-bold">สมัครสมาชิก</button></form></div>
  </div>
  <div class="text-center mt-4 pt-3 border-top"><a href="/" class="text-muted small text-decoration-none">กลับหน้าร้านค้า</a></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
document.getElementById('regF').onsubmit=(e)=>{e.preventDefault();fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:ru.value,password:rp.value})}).then(r=>r.json()).then(d=>{if(d.error)Swal.fire('ผิดพลาด',d.error,'error');else Swal.fire('สำเร็จ!','สมัครสมาชิกเรียบร้อย โปรดเข้าสู่ระบบ','success').then(()=>location.reload());});};
document.getElementById('loginF').onsubmit=(e)=>{e.preventDefault();fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:lu.value,password:lp.value})}).then(r=>r.json()).then(d=>{if(d.error)Swal.fire('เข้าสู่ระบบไม่ได้',d.error,'error');else{localStorage.setItem('user',JSON.stringify(d.user));location.href='/';}});};
</script></body></html>
  `);
});

// ================= ADMIN PAGE =================
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>Admin Panel | Caseme</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <style>body{font-family:'Kanit';background:#f4f6f9;}.card{border-radius:16px;}.form-control{border-radius:10px;}</style>
</head>
<body>
<script>
  const user = JSON.parse(localStorage.getItem('user'));
  if(!user || String(user.role).toLowerCase() !== 'admin') {
    window.location.href = '/';
  }
</script>

<nav class="navbar navbar-dark bg-dark py-3 shadow-sm"><div class="container">
  <span class="navbar-brand fw-bold"><i class="bi bi-shield-lock me-2"></i>ระบบจัดการหลังร้าน</span>
  <a href="/" class="btn btn-outline-light btn-sm px-3 rounded-pill">กลับหน้าร้าน</a>
</div></nav>

<div class="container mt-4 mb-5">
<div class="row mb-4" id="admin-dashboard">
  <div class="col-md-4 mb-3 mb-md-0">
    <div class="card bg-success text-white border-0 shadow-sm p-4 h-100 rounded-4">
      <h6 class="fw-bold opacity-75"><i class="bi bi-cash-coin me-2"></i>ยอดขายรวมทั้งหมด</h6>
      <h2 class="fw-bold mb-0" id="dash-sales">0 <small class="fs-5">฿</small></h2>
    </div>
  </div>
  <div class="col-md-4 mb-3 mb-md-0">
    <div class="card bg-warning text-dark border-0 shadow-sm p-4 h-100 rounded-4">
      <h6 class="fw-bold opacity-75"><i class="bi bi-clock-history me-2"></i>ออเดอร์รอตรวจสอบ</h6>
      <h2 class="fw-bold mb-0" id="dash-pending">0 <small class="fs-5">รายการ</small></h2>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card bg-danger text-white border-0 shadow-sm p-4 h-100 rounded-4">
      <h6 class="fw-bold opacity-75"><i class="bi bi-exclamation-triangle me-2"></i>สินค้าหมดสต็อก</h6>
      <h2 class="fw-bold mb-0" id="dash-out">0 <small class="fs-5">รายการ</small></h2>
    </div>
  </div>
</div>
  <div class="row g-4">
    <div class="col-md-4">
      <div class="card p-4 border-0 shadow-sm mb-4">
        <h6 class="fw-bold mb-3 text-primary"><i class="bi bi-plus-circle me-2"></i>เพิ่มสินค้าใหม่</h6>
        <input id="ni" class="form-control mb-2 bg-light" placeholder="ชื่อสินค้า">
        <input id="pi" type="number" class="form-control mb-2 bg-light" placeholder="ราคา">
        <input id="si" type="number" class="form-control mb-2 bg-light" placeholder="จำนวนสต็อก"><select id="ci" class="form-select mb-3 bg-light" style="border-radius:10px;">
  <option value="all">เลือกหมวดหมู่</option>
  <option value="iphone">iPhone</option>
  <option value="samsung">Samsung</option>
  <option value="oppovivo">OPPO / Vivo</option>
  <option value="transparent">เคสใส</option>
  <option value="shockproof">เคสกันกระแทก</option>
</select>
        <input id="ii" class="form-control mb-3 bg-light" placeholder="URL รูปภาพ">
        <button class="btn btn-primary w-100 fw-bold" onclick="add()">บันทึกข้อมูลสินค้า</button>
      </div>
      <div class="card p-3 border-0 shadow-sm"><h6 class="fw-bold mb-3">คลังสินค้า</h6><div id="plist"></div></div>
    </div>
    <div class="col-md-8">
      <div class="card p-4 border-0 shadow-sm h-100">
        <h5 class="fw-bold mb-4 text-success"><i class="bi bi-receipt me-2"></i>รายการสั่งซื้อ / ตรวจสอบสลิป</h5>
        <div id="olist"></div>
      </div>
    </div>
  </div>
</div>

<script>
function loadP(){
  fetch('/products').then(r=>r.json()).then(data=>{
    if(data.error) return console.log(data.error);
    let html = '';
    data.forEach(p => {
      let stockBadge = p.stock <= 0 ? '<span class="badge bg-danger ms-2">หมด</span>' : '<span class="badge bg-secondary ms-2">' + p.stock + ' ชิ้น</span>';
      html += '<div class="d-flex align-items-center border-bottom py-2">';
      html += '<img src="' + p.image + '" width="40" height="40" class="me-3 rounded" style="object-fit:cover;">';
      html += '<div class="flex-grow-1 small fw-bold">' + p.name + stockBadge + '</div>';
      html += '<button class="btn btn-outline-danger btn-sm rounded-circle px-2" onclick="del(' + p.id + ')"><i class="bi bi-trash"></i></button>';
      html += '</div>';
    });
    document.getElementById('plist').innerHTML = html || '<div class="text-muted text-center py-4">ยังไม่มีสินค้าในคลัง</div>';
  });
}

function add(){
  if(!ni.value || !pi.value || !ii.value || !si.value) return Swal.fire('แจ้งเตือน', 'กรอกข้อมูลให้ครบถ้วน', 'warning');
  fetch('/products',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      name:ni.value, 
      price:pi.value, 
      image:ii.value, 
      stock:si.value,
      category:ci.value
    })
  }).then(()=>{
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'เพิ่มสินค้าสำเร็จ', showConfirmButton: false, timer: 1500});
    ni.value=''; pi.value=''; ii.value=''; si.value=''; ci.value='all'; loadP();
  });
}

function del(id){
  Swal.fire({title: 'ลบสินค้านี้?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonText: 'ยกเลิก', confirmButtonText: 'ใช่, ลบทิ้ง!'})
  .then((result) => { if (result.isConfirmed) { fetch('/products/'+id,{method:'DELETE'}).then(loadP); } });
}

function loadO(){
  fetch('/api/orders').then(r=>r.json()).then(data=>{
    let html = '';
    data.forEach(o => {
      let bgClass = o.status === 'pending' ? 'bg-white shadow-sm border border-warning' : 'bg-light border-0';
      let badgeHtml = '';
      if(o.status === 'pending') badgeHtml = '<span class="badge bg-warning text-dark px-3 py-2"><i class="bi bi-clock me-1"></i>รอตรวจสอบ</span>';
      else if(o.status === 'approved') badgeHtml = '<span class="badge bg-info text-dark px-3 py-2"><i class="bi bi-box me-1"></i>รอจัดส่ง</span>';
      else if(o.status === 'shipped') badgeHtml = '<span class="badge bg-success px-3 py-2"><i class="bi bi-check-circle me-1"></i>จัดส่งแล้ว</span>';
      
      let productNames = 'สินค้า';
      try {
        let cartItems = JSON.parse(o.cart_data);
        // แสดงจำนวนชิ้นด้วย เช่น เคสใส (x2)
        productNames = cartItems.map(i => i.name + ' (x' + (i.qty || 1) + ')').join(', ');
      } catch(e) {}

      html += '<div class="p-4 rounded-4 mb-3 ' + bgClass + '">';
      html += '<div class="d-flex justify-content-between align-items-start mb-3">';
      html +=   '<div>';
      html +=     '<h6 class="mb-1 fw-bold text-dark">' + productNames + '</h6>';
      html +=     '<small class="text-muted fw-bold">ออเดอร์ #' + o.id + ' | ลูกค้า: ' + o.username + '</small>';
      html +=   '</div>';
      html +=   '<div>' + badgeHtml + '</div>';
      html += '</div>';
      
      html += '<div class="mb-3">ยอดชำระ: <b class="text-danger fs-5">' + o.total_price + ' ฿</b></div>';
      
      // 🟢 แสดงที่อยู่จัดส่งตรงนี้ 🟢
      let safeAddress = o.shipping_address ? o.shipping_address : 'ไม่มีข้อมูลที่อยู่';
      html += '<div class="mb-3 p-2 bg-white rounded border border-light small">';
      html +=   '<i class="bi bi-geo-alt-fill text-danger me-2"></i><span class="fw-bold me-1">จัดส่งที่:</span>' + safeAddress;
      html += '</div>';

      html += '<div class="d-flex gap-2 align-items-center flex-wrap">';
      html += '<a href="' + o.slip_image + '" target="_blank" class="btn btn-outline-dark btn-sm"><i class="bi bi-image me-1"></i>สลิป</a>';
      
      if(o.status === 'pending') {
        html += '<button class="btn btn-success btn-sm px-4 fw-bold" onclick="app(' + o.id + ')">ยืนยันรับยอด</button>';
      } else if (o.status === 'approved') {
        html += '<div class="input-group input-group-sm" style="max-width: 250px;">' +
                   '<input type="text" id="track-' + o.id + '" class="form-control" placeholder="ใส่เลขพัสดุ...">' +
                   '<button class="btn btn-primary fw-bold" onclick="ship(' + o.id + ')">แจ้งส่ง</button>' +
                 '</div>';
      } else if (o.status === 'shipped') {
        html += '<span class="text-success fw-bold small ms-2"><i class="bi bi-truck me-1"></i>Tracking: ' + o.tracking_number + '</span>';
      }
      html += '</div></div>';
    });
    document.getElementById('olist').innerHTML = html || '<div class="text-muted text-center py-5">ยังไม่มีรายการสั่งซื้อ</div>';
  });
}

function app(id){
  Swal.fire({title: 'ตรวจสอบสลิปถูกต้อง?', text: 'ยืนยันว่าได้รับยอดเงินเรียบร้อยแล้ว', icon: 'question', showCancelButton: true, confirmButtonColor: '#198754', cancelButtonText: 'ยกเลิก', confirmButtonText: 'ยืนยันรับยอด'})
  .then((result) => { if (result.isConfirmed) { fetch('/api/orders/'+id,{method:'PUT'}).then(loadO); } });
}

function ship(id) {
  const tracking = document.getElementById('track-' + id).value;
  if(!tracking) return Swal.fire('แจ้งเตือน', 'กรุณาใส่เลขพัสดุก่อนกดแจ้งส่งครับ', 'warning');
  
  fetch('/api/orders/'+id+'/ship', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ tracking: tracking })
  }).then(() => {
      Swal.fire({toast:true, position:'top-end', icon:'success', title:'แจ้งจัดส่งเรียบร้อย', showConfirmButton:false, timer:1500});
      loadO(); 
  });
}
function loadDash() {
  fetch('/api/admin/dashboard').then(r=>r.json()).then(data => {
    document.getElementById('dash-sales').innerHTML = data.sales + ' <small class="fs-5">฿</small>';
    document.getElementById('dash-pending').innerHTML = data.pending + ' <small class="fs-5">รายการ</small>';
    document.getElementById('dash-out').innerHTML = data.outOfStock + ' <small class="fs-5">รายการ</small>';
  });
}
loadP(); loadO(); loadDash();
</script>
</body></html>
  `);
});

// 🟢 ให้เซิร์ฟเวอร์จริงกำหนด Port ให้ (ถ้าไม่มีให้ใช้ 3000 ของเครื่องเรา)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});