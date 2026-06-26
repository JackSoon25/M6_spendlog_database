const express = require('express');
require('dotenv').config();
const mongoUri = process.env.MONGO_URI;
const dbName = 'spendlog';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const cors = require('cors');
const { connect } = require('./db');

// create the express application
const app = express();
// use the JSON middleware to receive JSON requests
app.use(express.json());

// =========== functions ==============
function generateAccessToken(id) {
    // arg 1: the claims, or the payload
    // arg 2: the hashing key
    // arg 3: configuration options
    return jwt.sign({
        "user_id": id,
        "role": " user"
    }, process.env.TOKEN_SECRET, {
        "expiresIn": "3h"
    })
}

// a middleware function happens before the routes is called
// the next parameter will refer to the next middleware
// or if there is no more middleware, then the actual route itself
function verifyToken(req, res, next) {

    next();
}



// ============== ROUTES ==============
// health check route
app.get('/health', function (req, res) {
    res.json({
        "message": "I'm alive!"
    });
})

// login route: /api/login
app.post('/api/login', async function (req, res) {
    try {
        const db = await connect(mongoUri, dbName);
        const email = req.body.email;
        const password = req.body.password;
        // find the user by email, check if pwd matches, if so, create and send back the JWT
        const user = await db.collection('users').findOne({ "email": email });
        if (user) {
            if (await bcrypt.compare(password, user.password)) {
                // create the JWT and send back
                const token = generateAccessToken(user._id);
                res.json({
                    "token" : token,
                    "message" : "successfully login"
                })
            } else {
                res.status(401).json({
                    "message": "Wrong email or password"
                })
            }
        } else {
            res.status(401).json({
                "message": "Wrong email or password"
            })
        }
    } catch (error) {
        res.status(500).json({ "message": error.message });
    }
})








app.listen(3000, function () {
    console.log('Server has started');
})

module.exports = { app };