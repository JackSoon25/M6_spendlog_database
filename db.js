const { MongoClient, ServerApiVersion } = require ('mongodb');

let client = null;

async function connect (uri, dbname) {
    if (client) {
        return client;
    }

    client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1
        }
    })

    // attempt to connect to mongo
    await client.connect();
    console.log("Connected to mongo");

    // return a database object
    // eqv. toin Mongo Compass: use dbname;
    return client.db(dbname);
}

// share the connect function with other JavaScript files
module.exports = { connect };