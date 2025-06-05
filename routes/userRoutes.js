const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// Ορισμός του middleware isUser
function isUser(req, res, next) {
    const user = req.session.user;  // Ανάκτηση του χρήστη από τη συνεδρία
    if (user && user.role === 'user') {
        return next();  // Αν ο χρήστης είναι user, προχωρά στην επόμενη συνάρτηση
    }
    res.status(403).send('Access denied: Only users are allowed to access this resource.');// Αν δεν είναι user, επιστρέφει 403
}
// Εφαρμογή του middleware στις διαδρομές του user
router.use(isUser);

// Διαδρομή για την κεντρική σελίδα του user
router.get('/dashboard', async (req, res) => { // Δήλωση της συνάρτησης ως async
    try {
        const user = req.session.user; // Λήψη χρήστη από τη συνεδρία
        const db = req.app.locals.db; // Πρόσβαση στο db από το app.locals
        const today = new Date();
        const programs = await db.collection('programs').find().toArray();
        const announcements = await db.collection('announcements')
            .find({ validUntil: { $gte: today } })
            .sort({ validUntil: 1 })
            .toArray(); // Μετατροπή σε array για χρήση
        res.render('userDashboard', { username: user.username, announcements, programs: programs }); // Πέρασμα δεδομένων στη σελίδα
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαδρομή για επιστροφή των στοιχείων του χρήστη χωρίς password και role
router.get('/profile', async (req, res) => {
    try {
        const user = req.session.user; // Λήψη του χρήστη από τη συνεδρία
        const db = req.app.locals.db; // Πρόσβαση στη βάση δεδομένων
        if (!user) {
            return res.status(401).send('Unauthorized: No user logged in');
        }
        const userProfile = await db.collection('users').findOne(
            { username: user.username }, // Κριτήριο αναζήτησης
            { projection: { password: 0, role: 0 } } // Εξαίρεση των πεδίων password και role
        );
        if (!userProfile) {
            return res.status(404).send('User not found');
        }
        res.render('profile', { user: userProfile }); // Απόδοση του EJS view
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Διαδρομή για προγράμματα
router.get('/services', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const user = req.session.user;
        const programs = await db.collection('programs').find().toArray();
        const appointments = await db.collection('appointments').find({username: user.username, status: "booked"}).toArray();
        return res.render('services', { availableSessions: [], appointments, programs, flashMessage: null });
    } catch (error) {
        console.error('Error fetching programs:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/availability', async (req, res) => {
    const { programId, date } = req.query;
    if (!programId || !date) {
        return res.status(400).send('Program ID and Date are required');
    }
    try {
        const db = req.app.locals.db;
        const user = req.session.user;
        const programCollection = db.collection('programs');
        const scheduleCollection = db.collection('schedule');
        const appointments = await db.collection('appointments').find({username: user.username, status: "booked"}).toArray();
        const programs = await programCollection.find().toArray();
        const program = await programCollection.findOne({ _id: new ObjectId(programId) });
        if (!program) {
            return res.status(404).send('Program not found');
        }
        const today = new Date();
        const inputDate = new Date(date);
        let query = {
            programId: new ObjectId(programId),
            day: date
        };
        if (today.toISOString().split('T')[0] === inputDate.toISOString().split('T')[0]) {
            query.time = { $gte: today.getHours() + ":" + (today.getMinutes() < 10 ? '0' : '') + today.getMinutes() };
        }
        const availableSessions = await scheduleCollection.find(query).toArray();
        let flashMessage = null;
        if (availableSessions.length === 0) {
            flashMessage = {
                type: 'warning',
                text: 'No available sessions for the selected date.'
            };
        }
        return res.render('services', { availableSessions, appointments, programs, flashMessage });
    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/book-appointment', async (req, res) => {
    const { sessionId } = req.body;
    const userId = req.session.user?._id;
    if (!sessionId || !userId) {
        return res.status(400).send('Session ID and User ID are required');
    }
    try {
        const db = req.app.locals.db;
        const sessionCollection = db.collection('schedule');
        const userCollection = db.collection('users');
        const appointmentsCollection = db.collection('appointments');
        // Verify the user exists
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).send('User not found');
        }
        // Check session availability
        const session = await sessionCollection.findOne({ _id: new ObjectId(sessionId) });
        if (!session) {
            return res.status(404).send('Session not found');
        }
        const now = new Date();
        // Then check for multiple cancellations within the same week
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        const userCancellationsThisWeek = await db.collection('cancellations').countDocuments({
            username: user.username,
            dateOfCancellation: { $gte: startOfWeek, $lt: endOfWeek }
        });
        let canBook = userCancellationsThisWeek < 2;
        // Update the canBook value for the cancellation record
        await db.collection('cancellations').updateMany(
            { username: user.username, canBook: false },
            { $set: { canBook: canBook } }
        );        
        const cancel = await db.collection('cancellations').findOne({username: user.username , canBook: false});
        const sessions = await sessionCollection.find({ programId: session.programId, day: session.day }).toArray();
        const appointments = await appointmentsCollection.find({username: user.username, status: "booked"}).toArray();
        const programs = await db.collection('programs').find().toArray();
        if (cancel) {
            return res.render('services', {
                availableSessions: sessions,
                appointments: appointments,
                programs,
                flashMessage: { type: 'danger', text: 'You have exceeded the cancellation limit and you can not make a new appointment for this week' }
            });
        }
        // Check if the user has already booked this program
        const existingAppointment = await appointmentsCollection.findOne({
            username: user.username,
            programName: session.programName,  // Assuming programId is stored in the session document
            trainerName: session.trainerName,
            time: session.time,
            status: { $in: ["booked", "confirmed"] }
        });
        if (existingAppointment) {
            return res.render('services', {
                availableSessions: sessions,
                appointments: appointments,
                programs,
                flashMessage: { type: 'danger', text: 'You have already booked an appointment for this program.' }
            });
        }
        if (session.capacity > 0) {
            await sessionCollection.updateOne(
                { _id: new ObjectId(sessionId) },
                { $inc: { capacity: -1 } }
            );
            // Record the appointment
            await appointmentsCollection.insertOne({
                sessionId: session._id,
                username: user.username,
                programName: session.programName,
                trainerName: session.trainerName,
                day: session.day,
                time: session.time,
                status: "booked"  
            });
            // Confirm the booking
            const updatedSessions = await sessionCollection.find({ programId: session.programId, day: session.day }).toArray();
            const updatedAppointments = await appointmentsCollection.find({username: user.username, status: "booked"}).toArray();
            return res.render('services', {
                availableSessions: updatedSessions,
                appointments: updatedAppointments,
                programs,
                flashMessage: { type: 'success', text: 'Appointment booked successfully!' }
            });
        } else {
            return res.status(409).send('No available slots for this time. Please choose a different time slot.');
        }
    } catch (error) {
        console.error('Error booking appointment:', error);
        res.status(500).send('Error processing your booking');
    }
});


router.post('/cancel-appointment', async (req, res) => {
    const { appointmentId } = req.body;
    const userId = req.session.user?._id;
    if (!appointmentId || !userId) {
        return res.status(400).send('Appointment ID and User ID are required');
    }
    try {
        const db = req.app.locals.db;
        const userCollection = db.collection('users');
        const appointmentsCollection = db.collection('appointments');
        const sessionCollection = db.collection('schedule');
        const cancellationsCollection = db.collection('cancellations');
        // Check if the user exists
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).send('User not found');
        }
        // Check if the appointment exists and belongs to the user
        const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(appointmentId), username: user.username });
        if (!appointment) {
            return res.status(404).send('Appointment not found');
        }
        // Check if the appointment can be cancelled (2 hours before start)
        const now = new Date();
        const twoHoursBefore = new Date(appointment.time);
        twoHoursBefore.setHours(twoHoursBefore.getHours() - 2);
        if (now > twoHoursBefore) {
            return res.status(403).send('Cancellation is only possible up to 2 hours before the appointment start time.');
        }
        // First record the cancellation without canBook
        await cancellationsCollection.insertOne({
            appointmentId: appointment._id,
            username: user.username,
            dateOfCancellation: new Date()
        });
        // Then check for multiple cancellations within the same week
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        const userCancellationsThisWeek = await cancellationsCollection.countDocuments({
            username: user.username,
            dateOfCancellation: { $gte: startOfWeek, $lt: endOfWeek }
        });
        let canBook = userCancellationsThisWeek < 2;
        // Update the canBook value for the cancellation record
        await cancellationsCollection.updateMany(
            { username: user.username, },
            { $set: { canBook: canBook } }
        );
        // Cancel the appointment
        await appointmentsCollection.updateOne(
            { _id: new ObjectId(appointmentId) },
            { $set: { status: 'cancelled' } }
        );
        // Restore capacity in the session
        await sessionCollection.updateOne(
            { _id: new ObjectId(appointment.sessionId) },
            { $inc: { capacity: 1 } }
        );
        const updatedAppointments = await appointmentsCollection.find({username: user.username, status: "booked"}).toArray();
        const programs = await db.collection('programs').find().toArray();
        return res.render('services', {
            availableSessions: [],
            appointments: updatedAppointments,
            programs,
            flashMessage: { type: 'success', text: 'Appointment cancelled successfully.' }
        });
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).send('Error processing your cancellation');
    }
});

// Διαδρομή για προγράμματα
router.get('/booking-history', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const user = req.session.user;
        const cancellationDate = await db.collection('cancellations').find({username: user.username}).toArray();
        const appointments = await db.collection('appointments').find({username: user.username}).sort({ day: 1 }).toArray();
        return res.render('bookingHistory', { appointments, cancellationDate });
    } catch (error) {
        console.error('Error fetching booking history:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;  // Εξαγωγή του router
