const express = require('express');
require('dotenv').config();
const mongoUri = process.env.MONGO_URI;
const dbName = 'spendlog';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const cors = require('cors');
const { connect } = require('./db');
const { ObjectId } = require('mongodb');
const axios = require('axios');
const { generateExpense, expenseReport } = require('./minimax');

// create the express application
const app = express();
// use the JSON middleware to receive JSON requests
app.use(express.json());

// =========== Assisting functions ==============
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
    //extract out the token from the authorization
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(" ")[1];
        if (token) {
            // verify the token's claims and expiry matchs the signature
            jwt.verify(token, process.env.TOKEN_SECRET, function (err, claims) {
                if (err) {
                    res.status(400).json({
                        "message": "Token invalid or expired"
                    })
                } else {
                    // save in the request the logged in user's information 
                    req.user = claims;
                    next();
                }
            })

        } else {
            res.status(400).json({
                "message": "Token not found"
            })
        }
    } else {
        res.status(400).json({
            "message": "Authorization header is not found"
        })
    }
}

// ============== MAIN function ==================
async function main() {

    const db = await connect(mongoUri, dbName);
    // ============== ROUTES ==============
    // health check route
    app.get('/health', function (req, res) {
        res.json({
            "message": "I'm alive!"
        });
    })

    // -----------1. Authentication Routes---------

    // POST '/api/auth/register', Create new user account (hash password before saving)
    app.post('/api/auth/register', async function (req, res) {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password) {
                return res.status(400).json({ "error": "all fields are required" });
            }
            const existing = await db.collection('users').findOne({ email });
            if (existing) {
                return res.status(400).json({ "error": "Email already registered" });
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            const result = await db.collection('users').insertOne({
                name,
                email,
                password: hashedPassword,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            res.status(201).json({ "user": result.insertedId });
        } catch (error) {
            res.status(500).json({ "error": "Registration failed" });
        }
    })

    // POST  `/api/auth/login` | Verify credentials, return JWT 
    app.post('/api/auth/login', async function (req, res) {
        try {
            const email = req.body.email;
            const password = req.body.password;
            // find the user by email, check if pwd matches, if so, create and send back the JWT
            const user = await db.collection('users').findOne({ "email": email });
            if (user) {
                if (await bcrypt.compare(password, user.password)) {
                    // create the JWT and send back
                    const token = generateAccessToken(user._id);
                    res.json({
                        "token": token,
                        "message": "successfully login"
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

    // POST /api/auth/logout
    app.post('/api/auth/logout', [verifyToken], function (req, res) {
        // With JWT, logout is handled client-side by deleting the stored token.
        res.json({ "message": "Logged out successfully" });
    });

    // GET '/api/auth/me', checking which user is accessing
    app.get('/api/auth/me', [verifyToken], async function (req, res) {
        try {
            const user = await db.collection("users").findOne({
                _id: new ObjectId(req.user.user_id)
            });
            delete user.password;
            res.json({
                "user": user
            });
        } catch (error) {
            res.status(500).json({ "message": error.message });
        }
    });

    // -----------2. Categories Routes | need to improve to control login user category-----------

    // GET /api/categories | List all categories
    app.get('/api/categories', [verifyToken], async function (req, res) {
        try {
            const filter = { userId: new ObjectId(req.user.user_id) }
            const result = await db.collection('categories').find(filter).toArray();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ "message": error.message });
        }
    })

    // POST /api/categories | Create a category
    app.post('/api/categories', [verifyToken], async function (req, res) {
        try {
            const { name } = req.body;
            console.log("new category name: ", name);
            const filter = {
                userId: new ObjectId(req.user.user_id),
                name: { $regex: name, $options: 'i' }
            };
            console.log("filter: ", filter);

            const existing = await db.collection('categories').findOne(filter);
            if (existing) {
                return res.status(400).json({ "error": "The category already exists." });
            };
            const newCategory = {
                userId: new ObjectId(req.user.user_id),
                name
            };
            const result = await db.collection('categories').insertOne(newCategory);
            res.status(201).json({ "_id": result.insertedId.toString(), ...newCategory });
        } catch (error) {
            res.status(500).json({ "error": "failed to create category" });
            console.error(error);
        }
    })

    // DELETE /api/categories/:id  | Delete a category 
    app.delete('/api/categories/:id', [verifyToken], async function (req, res) {
        try {
            const filter = {
                _id: new ObjectId(req.params.id),
                userId: new ObjectId(req.user.user_id)
            }
            const result = await db.collection('categories').deleteOne(filter);
            if (result.deletedCount === 0) {
                return res.status(404).json({ "error": "category not found" });
            } else {
                res.status(200).json({ "message": "Category is deleted" });
            }
        } catch (error) {
            res.status(500).json({ "error": "Failed to delete category" });
        }
    })

    // ---------- 3. Expense Routes --------------------

    // GET /api/expenses  | List all expenses for the login user (supports `?categoryId=...&from=...&to=...`) 
    app.get('/api/expenses', [verifyToken], async function (req, res) {
        try {
            const query = { "userId": new ObjectId(req.user.user_id) }; // only check login user expenses
            const result = await db.collection('expenses').find(query).toArray();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ "error": error });
        }
    })

    // GET /api/expenses/:id   | Get one expense (must belong to login user) 
    app.get('/api/expenses/:id', [verifyToken], async function (req, res) {
        try {
            const query = {
                "_id": new ObjectId(req.params.id),
                "userId": new ObjectId(req.user.user_id)
            };
            // troubleshooting code
            console.log('Query:', query);
            console.log('req.params.id:', req.params.id);  // What req.params.id actually is
            console.log('req.user.user_id:', req.user.user_id);  // What req.user.user_id actually is

            const result = await db.collection('expenses').findOne(query);
            if (result) {
                res.status(200).json(result);
            } else {
                res.status(404).json({ "message": "expense not found" });
            }

        } catch (error) {
            res.status(500).json({ "error": error.message });
            console.error("Error:", error);  //what is the error
        }
    })

    // POST /api/expenses      | Create a new expense for the login user 
    app.post('/api/expenses', [verifyToken], async function (req, res) {
        try {
            const { title, amount, currency, paymentMethod, date, notes, categoryName } = req.body;
            const newExpense = {
                userId: new ObjectId(req.user.user_id),
                title,
                amount,
                currency: currency || 'SGD',
                paymentMethod,
                date: new Date(date),
                notes: notes || '',
                categoryName
            }
            console.log("new Expense: ", newExpense);
            const result = await db.collection('expenses').insertOne(newExpense);
            if (result) {
                res.status(201).json({
                    _id: result.insertedId,
                    ...newExpense
                })
            } else {
                res.status(500).json({ "Message": "Fail to add new expense" });
            }
        } catch (error) {
            res.status(500).json({ "message": "Fail to add new expense" });
            console.error("Error: ", error);
        }
    })

    // PUT /api/expenses/:id   | Update an expense (must belong to login user)
    app.put('/api/expenses/:id', [verifyToken], async function (req, res) {
        try {
            const updates = { ...req.body };
            if (updates.date) {
                updates.date = new Date(updates.date);
            }
            delete updates.userId; // never let client overwrite ownership
            const filter = {
                _id: new ObjectId(req.params.id),
                userId: new ObjectId(req.user.user_id)
            };
            const result = await db.collection('expenses').updateOne(filter, { $set: updates });

            if (result.matchedCount === 0) {
                return res.status(404).json({ "error": "Expense not found" });
            }
            res.status(200).json({ "message": "Expense updated" });
        } catch (error) {
            res.status(500).json({ "message": "Can't update the expense" });
            console.error("Error: ", error);
        }
    })

    // DELETE /api/expenses/:id   | Delete an expense (must belong to login user) 
    app.delete('/api/expenses/:id', [verifyToken], async function (req, res) {
        try {
            const filter = {
                _id: new ObjectId(req.params.id),
                userId: new ObjectId(req.user.user_id)
            };
            const result = await db.collection('expenses').deleteOne(filter);
            if (result.deletedCount === 0) {
                return res.status(404).json({ "error": "Expense not found" });
            }
            res.status(200).json({ "message": "Expense is deleted" });
        } catch (error) {
            res.status(500).json({ "error": error.message });
        }
    })

    // ---------- 4. Budgets Routes ----------------

    // GET /api/budgets  | Get the login user's monthly budget(s); supports `?month=2026-06` 
    app.get('/api/budgets', [verifyToken], async function (req, res) {
        try {
            const { month } = req.query;
            const filter = { userId: new ObjectId(req.user.user_id) };
            if (month) {
                filter.month = month;
                const budget = await db.collection('budgets').find(filter).toArray();
                res.status(200).json(budget);
            } else {
                return res.status(500).json({ "Message": "Please indicate which month's budget you want to check." });
            }
        } catch (error) {
            res.status(500).json({ "Error": "Fail to the budget" })
        }
    })

    // POST /api/budgets  | Create a monthly budget for the login user
    app.post('/api/budgets', [verifyToken], async function (req, res) {
        try {
            const { monthlyLimit, month } = req.body;
            // check whether same monthly budget was created before.
            const existing = await db.collection('budgets').findOne({
                userId: new ObjectId(req.user.user_id),
                month,
            });
            if (existing) {
                return res.status(500).json({ "message": "The budget already exists, can't create again." });
            }
            const newBudget = {
                userId: new ObjectId(req.user.user_id),
                monthlyLimit,
                month
            }
            console.log("newBudget: ", newBudget);
            const budget = await db.collection('budgets').insertOne(newBudget);
            console.log("DB record of the new budget: ", budget);
            if (budget) {
                res.status(201).json({
                    _id: budget.insertedId,
                    ...newBudget
                });
            } else {
                res.status(500).json({ "message": "Failed to create the budget" });
            }
        } catch (error) {
            res.status(500).json({ "Error": "Fail to create new budget" });
        }
    })

    // PUT /api/budgets/:id | Update a monthly budget   
    app.put('/api/budgets/:id', [verifyToken], async function (req, res) {
        try {
            const updatedBudget = { ...req.body };
            const filter = {
                _id: new ObjectId(req.params.id),
                userId: new ObjectId(req.user.user_id),
            };

            const result = await db.collection('budgets').updateOne(filter, { $set: updatedBudget });
            if (result.matchedCount === 0) {
                return res.status(404).json({ "error": "Budget not found" });
            }

            res.status(200).json({ "message": "Budget is updated" });

        } catch (error) {
            res.status(500).json({ "Error": "Fail to update the budget" });
        }
    })

    // ----------- 5. AI search Routes ---------------

    //POST /api/ai/expenses | Parse natural language expense and insert it
    app.post('/api/ai/expenses', [verifyToken], async function (req, res) {
        try {
            const { description } = req.body;
            if (!description) {
                return res.status(400).json({ "error": "description is required" });
            }

            // Fetch users' categories
            const categoriesFilter = { "userId": new ObjectId(req.user.uesr_ud) };
            const categories = await db.collection('categories').find(categoriesFilter).toArray();

            // if use - categoryList = JSON.stringify(categories);
            // categoryList will become "[{_id:..., userId:..., name: 'Food'}, {_id:..., userId:..., name: 'Transport'}]"
            // this is not clean and waste tokens. So, better to define categoryList 
            // in a cleaner way: categories.map(function(c) {return c.name;}).join(',');
            const categoryList = categories.map(function (c) { return c.name; }).join(',');
            const schema = {
                "title": "Expense",
                "type": "object",
                "required": [
                    "userId",
                    "title",
                    "amount",
                    "currency",
                    "categoryName",
                    "paymentMethod",
                    "date"
                ],
                "properties": {
                    "userId": {
                        "type": "string",
                        "pattern": "^[a-fA-F0-9]{24}$",
                        "description": "Reference to the user who owns this expense"
                    },
                    "title": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200,
                        "examples": ["Dinner at Hawker Centre"]
                    },
                    "amount": {
                        "type": "number",
                        "minimum": 0,
                        "description": "Expense amount in the given currency"
                    },
                    "currency": {
                        "type": "string",
                        "minLength": 3,
                        "maxLength": 3,
                        "pattern": "^[A-Z]{3}$",
                        "description": "ISO 4217 currency code",
                        "examples": ["SGD", "USD", "EUR"]
                    },
                    "categoryName": {
                        "type": "string",
                        "minLength": 1,
                        "examples": ["Food", "Transport", "Utilities"]
                    },
                    "paymentMethod": {
                        "type": "string",
                        "enum": ["Cash", "Debit Card", "Credit Card", "Bank Transfer", "E-Wallet", "Other"],
                        "examples": ["Debit Card"]
                    },
                    "date": {
                        "type": "string",
                        "format": "date-time",
                        "description": "ISO 8601 timestamp (MongoDB BSON Date serialized)"
                    },
                    "notes": {
                        "type": "string",
                        "maxLength": 1000,
                        "description": "Optional free-text notes"
                    }
                },
                "additionalProperties": false
            }
            const userId = new ObjectId(req.user.user_id);

            // Call MiniMax to get new expense based on the description
            const newExpenseFromAI = await generateExpense(description, categoryList, userId, schema);

            // insert expense into collection - expenses
            const result = await db.collection('expenses').insertOne(newExpenseFromAI);
            //res.json(newExpenseFromAI);
            res.status(200).json({
                "Message": "New expense inserted rom natural text by AI",
                "expenseID": result.insertedId
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ "error": "Failed to create expense via AI" });
        }
    })


    //POST /api/ai/advices | Parse expense report based on natural language and insert it
    app.post('/api/ai/advices', [verifyToken], async function (req, res) {
        try {
            const { description } = req.body;
            if (!description) {
                return res.status(400).json({ "error": "description is required" });
            };

            const schema = {
                "collection": "advice",
                "fields": {
                    "userId": {
                        "type": "ObjectId",
                        "ref": "users",
                        "description": "References the _id of the user this advice was generated for"
                    },
                    "advice": {
                        "type": "String",
                        "description": "AI-generated spending insight or recommendation, based on the user's expense data for the given month"
                    },
                    "month": {
                        "type": "String",
                        "format": "YYYY-MM",
                        "description": "The month this advice applies to, e.g. \"2026-06\""
                    },
                    "createdAt": {
                        "type": "Date",
                        "description": "Timestamp of when this advice was generated"
                    }
                }
            };

            // Fetch user's monthly budget configuration
            const budgetFilter = { "userId": new ObjectId(req.user.user_id) };
            const monthlyBudgets = await db.collection('budgets').find(budgetFilter).toArray();

            // Fetch user's whole expense history
            const expenseFilter = { "userId": new ObjectId(req.user.user_id) };
            const expenseHistory = await db.collection('expenses').find(expenseFilter).toArray();

            const userId = new ObjectId(req.user.user_id);

            // Call MiniMax to get expense report  based on the description
            const expenseReportFromAI = await expenseReport(description, userId, expenseHistory, monthlyBudgets, schema);
                        
            // Rebuild the advice object — use JWT userId, NOT MiniMax's userId
            const advice = {
                userId: userId,  // Use JWT userId as ObjectId
                advice: expenseReportFromAI.fields.advice,
                month: expenseReportFromAI.fields.month,
                createdAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' })
            };

            // Insert into MongoDB
            const result = await db.collection('advices').insertOne(advice);

            console.log('Insert result:', result);
            console.log('Inserted advice:', advice);

            // Return the inserted document
            res.status(201).json({
                "_id": result.insertedId,
                ...advice
            });

        } catch (error) {
            res.status(500).json({ "Error": "AI can't generate any advice" });
        }
    })

    // app.listen
    app.listen(3000, function () {
        console.log('Server has started');
    })

}

main();

module.exports = { app };