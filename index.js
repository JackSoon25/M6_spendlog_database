const express = require('express');
require('dotenv').config();
const mongoUri = process.env.MONGO_URI;
const dbName = 'spendlog';
const bcrypt = require('bcrypt');

const cors = require('cors');
const { connect } = require('./db');

// create the express application
const app = express();
// use the JSON middleware to receive JSON requests
app.use(express.json());

// ============== ROUTES ==============
// health check route
app.get('/health', function(req,res) {
    res.json({
        "message" : "I'm alive!"
    });
})










app.listen(3000, function() {
    console.log('Server has started');
})

async function main() {
    try {
        const db = await connect(mongoUri, dbName);

    } catch (error) {
        console.error(error);
    }

}

main();

module.exports = {app};