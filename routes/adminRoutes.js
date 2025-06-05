const express = require('express');
const path = require('path'); 
const router = express.Router();
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');

// Ορισμός του middleware isAdmin
function isAdmin(req, res, next) {
    const user = req.session.user;  // Ανάκτηση του χρήστη από τη συνεδρία
    if (user && user.role === 'admin') {
        return next();  // Αν ο χρήστης είναι admin, προχωρά στην επόμενη συνάρτηση
    }
    res.status(403).send('Access denied: Only administrators are allowed to access this resource.');// Αν δεν είναι admin, επιστρέφει 403
}
// Εφαρμογή του middleware στις διαδρομές του admin
router.use(isAdmin);

// Διαδρομή για την κεντρική σελίδα του admin
router.get('/dashboard', (req, res) => {
    const user = req.session.user; // Λήψη χρήστη από τη συνεδρία
    res.render('adminDashboard', { username: user.username }); // Πέρασμα του username στη σελίδα
});

// Διαδρομή για τη σελίδα διαχείρισης αιτήσεων εγγραφής
router.get('/manage-registration-requests', async (req, res) => {
    try {
        const db = req.app.locals.db; // Πρόσβαση στο db από το app.locals
        const registrationRequests = await db.collection('registrationRequests').find().toArray();
        // Αν δεν υπάρχουν αιτήσεις, στείλε το μήνυμα μέσω flashMessage
        if (registrationRequests.length === 0) {
            return res.render('manageRegistrationRequests', { 
                registrationRequests: [], 
                flashMessage: { type: 'info', text: 'No registration requests found' } 
            });
        }
        // Αν υπάρχουν αιτήσεις, απόδωσε τις
        return res.render('manageRegistrationRequests', { registrationRequests, flashMessage: null });
    } catch (error) {
        console.error('Error fetching registration requests:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαδρομή για αποδοχή ή απόρριψη αιτήσεων εγγραφής
router.post('/manage-registration-request/:id', async (req, res) => {
    const { action } = req.body; // 'accept' ή 'reject'
    const { id } = req.params; // Το ID της αίτησης που θα αποδεχτεί ή θα απορριφθεί
    const { role } = req.body;  // Λαμβάνουμε τον ρόλο από τη φόρμα
    try {
        const db = req.app.locals.db;
        // Βρίσκουμε την αίτηση στη συλλογή registrationRequests
        const registrationRequest = await db.collection('registrationRequests').findOne({ _id: new ObjectId(id) });
        if (!registrationRequest) {
            return res.status(404).send('Registration Request not found');
        }
        let flashMessage = '';
        if (action === 'accept') {
            // Αν η αίτηση γίνει αποδεκτή
            const hashedPassword = await bcrypt.hash(registrationRequest.password, 10);
            // Δημιουργία χρήστη με τον επιλεγμένο ρόλο
            const newUser = {
                firstName: registrationRequest.firstName,
                lastName: registrationRequest.lastName,
                country: registrationRequest.country,
                city: registrationRequest.city,
                address: registrationRequest.address,
                email: registrationRequest.email,
                username: registrationRequest.username,
                password: hashedPassword,
                role: role || 'user',
            };
            // Εισαγωγή του νέου χρήστη στη συλλογή users
            await db.collection('users').insertOne(newUser);
            // Διαγραφή της αίτησης από τη συλλογή registrationRequests
            await db.collection('registrationRequests').deleteOne({ _id: new ObjectId(id) });
            flashMessage = { type: 'success', text: 'Registration request accepted successfully!' };
        } else if (action === 'reject') {
            // Αν η αίτηση απορριφθεί
            await db.collection('registrationRequests').deleteOne({ _id: new ObjectId(id) });
            flashMessage = { type: 'danger', text: 'Registration request rejected!' };
        } else {
            return res.status(400).send({ error: 'Invalid action' });
        }
        // Ανακτήστε ξανά τις αιτήσεις μετά την αποδοχή/απόρριψη
        const registrationRequests = await db.collection('registrationRequests').find().toArray();
        // Επιστροφή στη σελίδα με το μήνυμα και τις ανανεωμένες αιτήσεις
        return res.render('manageRegistrationRequests', { registrationRequests, flashMessage });
    } catch (error) {
        console.error('Error processing registration request:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Διαχείριση χρηστών - Εμφάνιση όλων των χρηστών
router.get('/manage-users', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const users = await db.collection('users').find().toArray();
        return res.render('manageUsers', { users, flashMessage: null});
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Επεξεργασία χρήστη - Φόρμα επεξεργασίας
router.get('/edit-user/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!user) {
            return res.status(404).send('User not found');
        }
        return res.render('editUser', { user, flashMessage: null });
    } catch (error) {
        console.error('Error fetching user for editing:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Επεξεργασία χρήστη
router.post('/update-user/:id', async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, email, country, city, address, username, password, role } = req.body;
    if (!firstName || !lastName || !email || !country || !city || !address || !username || !role) { 
        return res.status(400).send({ error: 'All fields are required' });
    }   
    try {
        const db = req.app.locals.db;
        // Έλεγχος αν υπάρχει ήδη το username ή το email από άλλον χρήστη
        const userWithEmail = await db.collection('users').findOne({ email, _id: { $ne: new ObjectId(id) } });
        const userWithUsername = await db.collection('users').findOne({ username, _id: { $ne: new ObjectId(id) } });
        if (userWithEmail) {
            return res.render('editUser', { 
                user: { ...req.body, _id: id }, 
                flashMessage: { type: 'danger', text: 'Email already exists, please choose another one.' }
            });
        }
        if (userWithUsername) {
            return res.render('editUser', { 
                user: { ...req.body, _id: id }, 
                flashMessage: { type: 'danger', text: 'Username already exists, please choose another one.' } 
            });
        }    
        const currentUser = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!currentUser) {
            return res.status(404).send('User not found');
        }
        // Έλεγχος αν είναι ο τελευταίος admin
        if (currentUser.role === 'admin' && role !== 'admin') {
            const adminCount = await db.collection('users').countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.render('editUser', { 
                    user: { ...req.body, _id: id }, 
                    flashMessage: { type: 'danger', text: 'Cannot change role of the last admin to user.' } 
                });
            }
        }
        const updateData = {
            firstName,
            lastName,
            email,
            country,
            city,
            address,
            username,
            role
        };
        // Ενημέρωση του password μόνο αν έχει δοθεί νέο
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData.password = hashedPassword;
        }
        await db.collection('users').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );       
        const users = await db.collection('users').find().toArray();
        return res.render('manageUsers', { 
            users, 
            flashMessage:{ type: 'success', text: 'User updated successfully!' } 
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαγραφή χρήστη
router.post('/delete-user/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const userToDelete = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!userToDelete) {
            return res.status(404).send('User not found');
        }
        if (userToDelete.role === 'admin') {
            // Έλεγχος αν υπάρχει τουλάχιστον άλλος ένας διαχειριστής
            const adminCount = await db.collection('users').countDocuments({
                role: 'admin',
                _id: { $ne: new ObjectId(id) }, // Εξαίρεση του χρήστη προς διαγραφή
            });
            if (adminCount === 0) {
                const users = await db.collection('users').find().toArray();
                return res.render('manageUsers', { 
                    users, 
                    flashMessage: { type: 'danger', text: 'Cannot delete the last admin.' }
                });
            }
        }
        await db.collection('users').deleteOne({ _id: new ObjectId(id) });
        const users = await db.collection('users').find().toArray();
        return res.render('manageUsers', { 
            users, 
            flashMessage: { type: 'success', text: 'User deleted successfully!' }
        });    
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.get('/manage-system-structure', (req, res) => {
    res.sendFile(path.join(__dirname, '../templates/manageSystemStructure.html'));
});

// CRUD για γυμναστές
router.get('/manage-trainers', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const trainers = await db.collection('trainers').find().toArray();
        const programs = await db.collection('programs').find().toArray();
        return res.render('manageTrainers', { trainers, programs, flashMessage: null });
    } catch (error) {
        console.error('Error fetching trainers:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/trainers', async (req, res) => {
    const { firstName, lastName, specialty } = req.body;
    if (!firstName || !lastName) { 
        return res.status(400).send({ error: 'All fields are required' });   
    }  
    try {
        const db = req.app.locals.db;
        // Έλεγχος αν το όνομα υπάρχει ήδη
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        const existingΤrainer = await db.collection('trainers').findOne({ firstName, lastName });
        if (existingΤrainer) {
            return res.render('manageTrainers', { 
                trainers, programs,
                flashMessage: { type: 'danger', text: 'A trainer with this name already exists' }
            });
        }
        if (!specialty || (Array.isArray(specialty) && specialty.length === 0) || (!Array.isArray(specialty) && specialty.trim() === '')) {
            return res.render('manageTrainers', { 
                trainers, programs,
                flashMessage: { type: 'danger', text: 'At least one speciality is required' }
            });
        }
        const specialties = Array.isArray(specialty) ? specialty.slice(0, 6) : [specialty].filter(Boolean);
        await db.collection('trainers').insertOne({ firstName, lastName, specialty: specialties });
        const newTrainers = await db.collection('trainers').find().toArray();
        return res.render('manageTrainers', { 
            trainers: newTrainers, programs,
            flashMessage: { type: 'success', text: 'Trainer added successfully!' }
        });
    } catch (error) {
        console.error('Error adding trainer:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/trainers/update/:id', async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, specialty } = req.body;
    if (!firstName || !lastName) { 
        return res.status(400).send({ error: 'All fields are required' });   
    }  
    try {
        const db = req.app.locals.db;
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        const existingΤrainer = await db.collection('trainers').findOne({ firstName, lastName, _id: { $ne: new ObjectId(id) } });
        if (existingΤrainer) {
            return res.render('manageTrainers', { 
                trainers, programs,
                flashMessage: { type: 'danger', text: 'A trainer with this name already exists' }
            });
        }
        const trainerToUpdate = await db.collection('trainers').findOne({ _id: new ObjectId(id) });
        if (!trainerToUpdate) {
            return res.status(404).send('Trainer not found');
        }
        if (!specialty || (Array.isArray(specialty) && specialty.length === 0) || (!Array.isArray(specialty) && specialty.trim() === '')) {
            return res.render('manageTrainers', { 
                trainers, programs,
                flashMessage: { type: 'danger', text: 'At least one speciality is required' }
            });
        }
        const specialties = Array.isArray(specialty) ? specialty.slice(0, 6) : [specialty].filter(Boolean);
        await db.collection('trainers').updateOne(
            { _id: new ObjectId(id) },
            { $set: { firstName, lastName, specialty: specialties } }
        );
        const updatedTrainers = await db.collection('trainers').find().toArray();
        return res.render('manageTrainers', { 
            trainers: updatedTrainers, programs,
            flashMessage: { type: 'success', text: 'Trainer updated successfully!' }
        });
    } catch (error) {
        console.error('Error updating trainer:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/trainers/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const programs = await db.collection('programs').find().toArray();
        const trainerToDelete = await db.collection('trainers').findOne({ _id: new ObjectId(id) });
        if (!trainerToDelete) {
            return res.status(404).send('Trainer not found');
        }
        await db.collection('trainers').deleteOne({ _id: new ObjectId(id) });
        // Διαγραφή όλων των schedules που περιλαμβάνουν τον trainer
        await db.collection('schedule').deleteMany({ trainerId: new ObjectId(id) });
        const trainers = await db.collection('trainers').find().toArray();
        return res.render('manageTrainers', { 
            trainers, programs,
            flashMessage: { type: 'success', text: 'Trainer deleted successfully!' }
        });
    } catch (error) {
        console.error('Error deleting trainer:', error);
        res.status(500).send('Internal Server Error');
    }
});


// CRUD για προγράμματα
router.get('/manage-gym-programs', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const programs = await db.collection('programs').find().toArray();
        return res.render('managePrograms', { programs, flashMessage: null });
    } catch (error) {
        console.error('Error fetching programs:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Πποσθήκη Προγράμματος 
router.post('/programs', async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).send('A program name is required');
    }
    try {
        const db = req.app.locals.db;
        const programs = await db.collection('programs').find().toArray();
        // Έλεγχος αν το όνομα υπάρχει ήδη
        const existingProgram = await db.collection('programs').findOne({ name: name });
        if (existingProgram) {
            return res.render('managePrograms', { 
                programs,
                flashMessage: { type: 'danger', text: 'A program with this name already exists' }
            });
        }
        // Προσθήκη του προγράμματος αν δεν υπάρχει
        await db.collection('programs').insertOne({ name, description });
        const newPrograms = await db.collection('programs').find().toArray();
        return res.render('managePrograms', { 
            programs: newPrograms,
            flashMessage: { type: 'success', text: 'Program added successfully!' }
        });
    } catch (error) {
        console.error('Error adding program:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Ενημέρωση Προγράμματος
router.post('/programs/update/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) { 
        return res.status(400).send({ error: 'A program name is required' });   
    }  
    try {
        const db = req.app.locals.db;
        const programToUpdate = await db.collection('programs').findOne({ _id: new ObjectId(id) });
        if (!programToUpdate) {
            return res.status(404).send('Program not found');
        }
        const programs = await db.collection('programs').find().toArray();
        const existingProgram = await db.collection('programs').findOne({ name, _id: { $ne: new ObjectId(id) } });
        if (existingProgram) {
            return res.render('managePrograms', { 
                programs,
                flashMessage: { type: 'danger', text: 'A program with this name already exists' }
            });
        }
        await db.collection('programs').updateOne(
            { _id: new ObjectId(id) },
            { $set: { name, description } }
        );
        const updatedPrograms = await db.collection('programs').find().toArray();
        return res.render('managePrograms', { 
            programs: updatedPrograms,
            flashMessage: { type: 'success', text: 'Program updated successfully!' }
        });
    } catch (error) {
        console.error('Error updating program:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαγραφή Προγράμματος
router.post('/programs/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const programToDelete = await db.collection('programs').findOne({ _id: new ObjectId(id) });
        if (!programToDelete) {
            return res.status(404).send('Program not found');
        }
        await db.collection('programs').deleteOne({ _id: new ObjectId(id) });
        const programs = await db.collection('programs').find().toArray();
        // Διαγραφή όλων των schedules που περιλαμβάνουν το program
        await db.collection('schedule').deleteMany({ programId: new ObjectId(id) });
        res.render('managePrograms', { 
            programs,
            flashMessage: { type: 'success', text: 'Program deleted successfully!' }
        });    
    } catch (error) {
        console.error('Error deleting program:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Εμφάνιση προγραμματισμών
router.get('/manage-schedule', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const schedule = await db.collection('schedule').find().toArray();
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        return res.render('manageSchedule', { schedule, programs, trainers, flashMessage: null });
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Εκπαιδευτές βάση προγράμματος
router.get('/trainers-by-program', async (req, res) => {
    const { programName } = req.query;
    if (!programName) {
        return res.status(400).send({ error: 'Program name is required' });
    }
    try {
        const db = req.app.locals.db;
        const trainers = await db.collection('trainers').find({
            specialty: { $in: [programName] },
        }).toArray();

        return res.status(200).send(trainers);
    } catch (error) {
        console.error('Error fetching trainers:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Προσθήκη νέου προγραμματισμού
router.post('/schedule', async (req, res) => {
    const { programName, trainerName, day, time, capacity } = req.body;
    if (!programName || !trainerName || !day || !time || !capacity) {
        return res.status(400).send({ error: 'All fields are required' });
    }
    try {
        const db = req.app.locals.db;
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        const schedule = await db.collection('schedule').find().toArray();
        // Εύρεση τρέχουσας ημερομηνίας και ώρας
        const now = new Date();
        const scheduleDate = new Date(`${day}T${time}`);
        // Έλεγχος αν η ημερομηνία και η ώρα είναι στο παρελθόν
        if (scheduleDate < now) {
            return res.render('manageSchedule', { 
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The selected date and time are in the past' }
            });
        }
        // Έλεγχος αν είναι Κυριακή
        const dayOfWeek = scheduleDate.getDay();
        if (dayOfWeek === 0) {
            return res.render('manageSchedule', { 
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The gym is closed on Sundays' }
            });
        }
        // Έλεγχος ωραρίου ανά ημέρα
        const hour = scheduleDate.getHours();
        if (
            (dayOfWeek >= 1 && dayOfWeek <= 5 && (hour < 9 || hour >= 21)) || // Καθημερινές 09:00 - 21:00
            (dayOfWeek === 6 && (hour < 9 || hour >= 17)) // Σάββατο 09:00 - 17:00
        ) {
            return res.render('manageSchedule', { 
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The gym is closed during the selected time' }
            });
        }
        // Εύρεση προγράμματος και γυμναστή
        const program = await db.collection('programs').findOne({ name: programName });
        const trainer = await db.collection('trainers').findOne({ 
            $and: [
                { firstName: trainerName.split(' ')[0] },
                { lastName: trainerName.split(' ')[1] },
            ]
        });
        if (!program) {
            return res.status(404).send('Program not found');
        }
        if (!trainer) {
            return res.status(404).send('Trainer not found');
        }            
        if (!trainer.specialty.includes(program.name)) {
            return res.status(400).send({ error: 'Trainer does not have the required specialty' });   
        }
        const nextScheduleTime = new Date(scheduleDate.getTime() + 60 * 60 * 1000); // Προσθήκη 1 ώρας
        // Αναζήτηση όλων των προγραμμάτων για τον ίδιο γυμναστή και την ίδια μέρα
        const trainerSchedules = await db.collection('schedule').find({ 
            trainerId: trainer._id, 
            day: day 
        }).toArray();
        // Έλεγχος επικαλυπτόμενων ωρών
        for (const schedule of trainerSchedules) {
            const scheduleTime = new Date(`${day}T${schedule.time}`);
            if (
                (scheduleTime >= scheduleDate && scheduleTime < nextScheduleTime) || // Επικάλυψη επόμενης ώρας
                (scheduleDate >= scheduleTime && scheduleDate < new Date(scheduleTime.getTime() + 60 * 60 * 1000)) // Επικάλυψη τρέχουσας
            ) {
                const schedules = await db.collection('schedule').find().toArray(); // Ανάκτηση όλων των προγραμμάτων
                return res.render('manageSchedule', { 
                    schedule: schedules, programs, trainers,
                    flashMessage: { type: 'danger', text: 'The trainer is already scheduled for this or the next hour' }
                });
            }
        }
        // Προσθήκη στο schedule
        await db.collection('schedule').insertOne({
            programId: program._id,
            programName: program.name,
            trainerId: trainer._id,
            trainerName: `${trainer.firstName} ${trainer.lastName}`,
            day,
            time,
            capacity: parseInt(capacity, 10),
        });
        const NewSchedules = await db.collection('schedule').find().toArray();
        return res.render('manageSchedule', { 
            schedule: NewSchedules, programs, trainers,
            flashMessage: { type: 'success', text: 'Schedule added successfully!' }
        });
    } catch (error) {
        console.error('Error adding schedule:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Ενημέρωση προγραμματισμού
router.post('/schedule/update/:id', async (req, res) => {
    const { id } = req.params;
    const { programName, trainerName, day, time, capacity } = req.body;
    if (!programName || !trainerName || !day || !time || !capacity) {
        return res.status(400).send({ error: 'All fields are required' });
    }
    try {
        const db = req.app.locals.db;
        const scheduleToUpdate = await db.collection('schedule').findOne({ _id: new ObjectId(id) });
        if (!scheduleToUpdate) {
            return res.status(404).send('Schedule not found');
        }
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        const schedule = await db.collection('schedule').find().toArray();
        const now = new Date();
        const scheduleDate = new Date(`${day}T${time}`);
        // Έλεγχος αν η ημερομηνία και η ώρα είναι στο παρελθόν
        if (scheduleDate < now) {
            return res.render('manageSchedule', {
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The selected date and time are in the past' }
            });
        }
        // Έλεγχος αν είναι Κυριακή
        const dayOfWeek = scheduleDate.getDay();
        if (dayOfWeek === 0) {
            return res.render('manageSchedule', {
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The gym is closed on Sundays' }
            });
        }
        // Έλεγχος ωραρίου ανά ημέρα
        const hour = scheduleDate.getHours();
        if (
            (dayOfWeek >= 1 && dayOfWeek <= 5 && (hour < 9 || hour >= 21)) ||
            (dayOfWeek === 6 && (hour < 9 || hour >= 17))
        ) {
            return res.render('manageSchedule', {
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'The gym is closed during the selected time' }
            });
        }
        // Εύρεση προγράμματος και γυμναστή
        const program = await db.collection('programs').findOne({ name: programName });
        const trainer = await db.collection('trainers').findOne({
            $and: [
                { firstName: trainerName.split(' ')[0] },
                { lastName: trainerName.split(' ')[1] },
            ]
        });
        if (!program) {
            return res.status(404).send('Program not found');
        }
        if (!trainer) {
            return res.status(404).send('Trainer not found');
        }
        if (!trainer.specialty.includes(program.name)) {
            return res.render('manageSchedule', {
                schedule, programs, trainers,
                flashMessage: { type: 'danger', text: 'Trainer does not have the required specialty' }
            });
        }
        const nextScheduleTime = new Date(scheduleDate.getTime() + 60 * 60 * 1000);
        const trainerSchedules = await db.collection('schedule').find({
            trainerId: trainer._id,
            day: day
        }).toArray();
        // Έλεγχος επικαλυπτόμενων ωρών
        for (const scheduleItem of trainerSchedules) {
            if (scheduleItem._id.toString() === id) continue; // Παράβλεψη του ίδιου προγραμματισμού
            const scheduleTime = new Date(`${day}T${scheduleItem.time}`);
            if (
                (scheduleTime >= scheduleDate && scheduleTime < nextScheduleTime) ||
                (scheduleDate >= scheduleTime && scheduleDate < new Date(scheduleTime.getTime() + 60 * 60 * 1000))
            ) {
                const schedules = await db.collection('schedule').find().toArray(); // Ανάκτηση όλων των προγραμμάτων
                return res.render('manageSchedule', {
                    schedule: schedules, programs, trainers,
                    flashMessage: { type: 'danger', text: 'The trainer is already scheduled for this or the next hour' }
                });
            }
        }
        // Ενημέρωση προγραμματισμού
        await db.collection('schedule').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    programId: program._id,
                    programName: program.name,
                    trainerId: trainer._id,
                    trainerName: `${trainer.firstName} ${trainer.lastName}`,
                    day,
                    time,
                    capacity: parseInt(capacity, 10),
                }
            }
        );
        const updatedSchedule = await db.collection('schedule').find().toArray();
        return res.render('manageSchedule', {
            schedule: updatedSchedule, programs, trainers,
            flashMessage: { type: 'success', text: 'Schedule updated successfully!' }
        });
    } catch (error) {
        console.error('Error updating schedule:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαγραφή προγραμματισμού
router.post('/schedule/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const scheduleToDelete = await db.collection('schedule').findOne({ _id: new ObjectId(id) });
        if (!scheduleToDelete) {
            return res.status(404).send('Schedule not found');
        }
        await db.collection('schedule').deleteOne({ _id: new ObjectId(id) });
        const schedule = await db.collection('schedule').find().toArray();
        const programs = await db.collection('programs').find().toArray();
        const trainers = await db.collection('trainers').find().toArray();
        return res.render('manageSchedule', { 
            schedule, programs, trainers,
            flashMessage: { type: 'success', text: 'Schedule deleted successfully!' }
        });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).send('Internal Server Error');
    }
});


// CRUD για ανακοινώσεις
router.get('/manage-announcements', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const announcements = await db.collection('announcements').find().toArray();
        return res.render('ManageAnnouncements', { announcements, flashMessage: null });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Δημιουργία νέας ανακοίνωσης
router.post('/announcements', async (req, res) => {
    const { title, content, validUntil } = req.body;
    if (!title || !content || !validUntil) {
        return res.status(400).send({ error: 'All fields are required' });
    }
    try {
        const db = req.app.locals.db;
        const announcements = await db.collection('announcements').find().toArray();
        const validUntilDate = new Date(validUntil);
        const currentDate = new Date();
        // Έλεγχος αν η ημερομηνία validUntil είναι στο παρελθόν
        if (validUntilDate < currentDate) {
            return res.render('ManageAnnouncements', { 
                announcements, 
                flashMessage: { type: 'danger', text: 'The valid Until date must be in the future' }
            });
        }
        const newAnnouncement = {
            title,
            content,
            validUntil: validUntilDate,
            createdAt: new Date()
        };
        await db.collection('announcements').insertOne(newAnnouncement);
        const NewAnnouncements = await db.collection('announcements').find().toArray();
        return res.render('ManageAnnouncements', { 
            announcements: NewAnnouncements, 
            flashMessage: { type: 'success', text: 'Announcement added successfully!' }
        });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Ενημέρωση ανακοίνωσης
router.post('/announcements/update/:id', async (req, res) => {
    const { id } = req.params;
    const { title, content, validUntil } = req.body;
    if (!title || !content || !validUntil) {
        return res.status(400).send({ error: 'All fields are required' });
    }
    try {
        const db = req.app.locals.db;
        const announcement = await db.collection('announcements').findOne({ _id: new ObjectId(id) });
        if (!announcement) {
            return res.status(404).send('Announcement not found');
        }
        const announcements = await db.collection('announcements').find().toArray();
        const validUntilDate = new Date(validUntil);
        const currentDate = new Date();
        // Έλεγχος αν η ημερομηνία validUntil είναι στο παρελθόν
        if (validUntilDate < currentDate) {
            return res.render('ManageAnnouncements', { 
                announcements, 
                flashMessage: { type: 'danger', text: 'The valid Until date must be in the future' }
            });
        }
        await db.collection('announcements').updateOne(
            { _id: new ObjectId(id) },
            { $set: { 
                title, 
                content, 
                validUntil: validUntilDate
            } }
        );
        const NewAnnouncements = await db.collection('announcements').find().toArray();
        return res.render('ManageAnnouncements', { 
            announcements: NewAnnouncements, 
            flashMessage: { type: 'success', text: 'Announcement updated successfully!' }
        });
    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαγραφή ανακοίνωσης
router.post('/announcements/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const db = req.app.locals.db;
        const announcement = await db.collection('announcements').findOne({ _id: new ObjectId(id) });
        if (!announcement) {
            return res.status(404).send('Announcement not found');
        }
        await db.collection('announcements').deleteOne({ _id: new ObjectId(id) });
        const announcements = await db.collection('announcements').find().toArray();
        return res.render('ManageAnnouncements', { 
            announcements, 
            flashMessage: { type: 'success', text: 'Announcement deleted successfully!' }
        });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;  // Εξαγωγή του router
