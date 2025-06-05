const express = require('express');
const session = require('express-session');  // Εισαγωγή του express-session
const bcrypt = require('bcrypt'); // Για την ασφαλή αποθήκευση των κωδικών πρόσβασης
const path = require('path'); // Χρήση του path για διαχείριση αρχείων και φακέλων
const app = express();
const port = 3000;
// Σύνδεση με το MongoDB
const { MongoClient } = require('mongodb');
const uri = "mongodb://localhost:27017"; 
const client = new MongoClient(uri);

app.listen(port, () => {
    console.log('App is running at http://localhost:' + port);
});
// Ρύθμιση του session middleware
app.use(session({
    secret: 'your-secret-key',  // Κλειδί για την κρυπτογράφηση της συνεδρίας
    resave: false,
    saveUninitialized: true
}));
// Middleware για να διαχειριζόμαστε JSON δεδομένα
app.use(express.json());
// Για την ανάλυση της φόρμας URL encoded
app.use(express.urlencoded({ extended: true })); 

app.use(express.static(path.join(__dirname, 'templates')));
app.use('/css', express.static(path.join(__dirname, 'css')));

// Χρησιμοποιούμε async/await για να περιμένουμε τη σύνδεση
async function connectDB() {
    try {
        await client.connect(); // Περιμένουμε τη σύνδεση
        console.log('Connected to MongoDB');
        db = client.db('GoldenGym'); // Αποθηκεύουμε τη βάση δεδομένων στη μεταβλητή db
        app.locals.db = db; // Αποθήκευση του db στο app.locals
        await createAdminUser(); // Κλήση για να δημιουργηθεί ο χρήστης admin αφού η σύνδεση έχει ολοκληρωθεί
    } 
    catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}
// Κλήση της συνάρτησης για να συνδεθούμε με τη βάση δεδομένων
connectDB();

async function createAdminUser() {
    try {
        // Έλεγχος αν ο χρήστης admin υπάρχει ήδη
        const existingAdmin = await db.collection('users').findOne({ username: 'admin' });
        if (!existingAdmin) {
            // Κρυπτογράφηση του κωδικού του admin
            const hashedPassword = await bcrypt.hash('admin321', 10);
            // Δημιουργία χρήστη admin
            const adminUser = {
                firstName: 'Admin',
                lastName: 'Admin lastname',
                country: 'Greece',
                city: 'Athens',
                address: 'Unknown',
                email: 'admin@example.com',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
            };
            // Εισαγωγή του χρήστη στη βάση δεδομένων
            await db.collection('users').insertOne(adminUser);
            console.log('Admin user created successfully');
        } 
        else {
            console.log('Admin user already exists');
        }
    } 
    catch (error) {
        console.error('Error creating admin user:', error);
    }
}


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});


app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'register.html'));
});
// Route για εγγραφή χρήστη
app.post('/register', async (req, res) => {
    const { firstName, lastName, country, city, address, email, username, password } = req.body;
    if (!firstName || !lastName || !country || !city || !address || !email || !username || !password) {
        return res.status(400).send({ error: 'All fields are required' });
    }
    try {
        // Έλεγχος αν το username ή το email υπάρχει ήδη στις εκκρεμείς αιτήσεις 
        const existingRequest = await db.collection('registrationRequests').findOne({
            $or: [
                { username },
                { email }
            ]
        });
        // Έλεγχος αν το username ή το email υπάρχει ήδη στους εγγεγραμμένους χρήστες
        const existingUser = await db.collection('users').findOne({
            $or: [
                { username },
                { email }     
            ]
        });
        if (existingUser) {
            // Αν βρεθεί χρήστης με το ίδιο username ή email στην βάση
            if (existingUser.username === username) {
                return res.status(400).send({ error: 'Username already exists' });
            }
            if (existingUser.email === email) {
                return res.status(400).send({ error: 'Email already exists' });
            }
        } 
        else if (existingRequest) {
            // Αν βρεθεί αίτημα εγγραφής με το ίδιο username ή email
            if (existingRequest.username === username) {
                return res.status(400).send({ error: 'Username request already exists' });
            }
            if (existingRequest.email === email) {
                return res.status(400).send({ error: 'Email request already exists' });
            }
        }        
        // Δημιουργία νέου χρήστη
        const newUser = {
            firstName,
            lastName,
            country,
            city,
            address,
            email,
            username,
            password
        };
        // Εισαγωγή στη συλλογή αιτήσεων
        await db.collection('registrationRequests').insertOne(newUser);
        res.status(201).send({ message: 'Registration request submitted for approval' });
    } 
    catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});


app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});
// Route για σύνδεση χρήστη
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        req.session.user = null; // Καθαρισμός συνεδρίας
        return res.status(400).send({ error: 'Username and password are required' });
    }
    try {
        // Αναζήτηση του χρήστη στη βάση δεδομένων
        const user = await db.collection('users').findOne({ username });
        if (!user) {
            req.session.user = null; // Καθαρισμός συνεδρίας
            return res.status(401).send({ error: 'Invalid username or password' });
        }
        // Έλεγχος του password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            req.session.user = null; // Καθαρισμός συνεδρίας
            return res.status(401).send({ error: 'Invalid username or password' });
        }
        // Αποθήκευση του χρήστη στην session
        req.session.user = user;
        // Έλεγχος αν ο χρήστης έχει ρόλο admin ή user
        if (user.role === 'admin') {
            return res.status(200).send({ message: 'Login successful', isAdmin: true });
        }
        else if (user.role === 'user') {
            return res.status(200).send({ message: 'Login successful', isUser: true });
        }
    } 
    catch (error) {
        console.error('Error during login:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});


// Route για logout
app.get('/logout', (req, res) => {
    if (!req.session.user) {
        // Αν δεν υπάρχει χρήστης στη συνεδρία, απαγορεύουμε την πρόσβαση
        return res.status(403).send({ error: 'Access denied: You must be logged in to log out' });
    }
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send({ error: 'Failed to log out' });
        }
        // Ανακατεύθυνση στη αρική σελίδα μετά το logout
        res.redirect('/');
    });
});


// Εισάγουμε τα routes του admin
const adminRoutes = require('./routes/adminRoutes');
app.use('/admin', adminRoutes);

// Εισάγουμε τα routes του admin
const userRoutes = require('./routes/userRoutes');
app.use('/user', userRoutes);

app.set('view engine', 'ejs'); // Ορίζουμε το EJS ως view engine
app.set('views', path.join(__dirname, 'templates')); // Ορίζουμε το φάκελο με τα templates
