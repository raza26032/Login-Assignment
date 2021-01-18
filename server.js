var express = require("express");
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cors = require("cors");
var morgan = require("morgan");
const mongoose = require("mongoose");
var bcrypt = require("bcrypt-inzi");
var jwt = require('jsonwebtoken');
path = require("path")

var SERVER_SECRET = process.env.SECRET || "1234";

let dbURI = "mongodb+srv://raza26032:raza26032@cluster0.ypq3m.mongodb.net/firstDB?retryWrites=true&w=majority";
mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true });

mongoose.connection.on('connected', function () {
    console.log("Mongoose is connected");
});

mongoose.connection.on('disconnected', function () {
    console.log("Mongoose is disconnected");
    process.exit(1);
});

mongoose.connection.on('error', function (err) {
    console.log('Mongoose connection error: ', err);
    process.exit(1);
});

process.on('SIGINT', function () {
    console.log("app is terminating");
    mongoose.connection.close(function () {
        console.log('Mongoose default connection closed');
        process.exit(0);
    });
})

var userSchema = new mongoose.Schema({
    "name": String,
    "email": String,
    "password": String,
    "phone": String,
    "createdOn": { "type": Date, "default": Date.now },
    "activeSince": Date
})

var userModel = mongoose.model("users", userSchema);

var app = express();

app.use(bodyParser.json());
app.use(cookieParser());

app.use(cors({
    origin: "*",
    credentials: true
}));

app.use(morgan('dev'));

app.use("/", express.static(path.resolve(path.join(__dirname, "./public"))))

app.post("/signup", (req, res, next) => {
    if (!req.body.name
        || !req.body.email
        || !req.body.password
        || !req.body.phone) {

        res.status(403).send(`
            please send name, email, passwod, phone and gender in json body.
            e.g:
            {
                "name": "Ahmed",
                "email": "ahmed@gmail.com",
                "password": "abc",
                "phone": "03123456789"
            }`)
        return;
    }
    userModel.findOne({ email: req.body.email },
        function (err, doc) {
            if (!err && !doc) {

                bcrypt.stringToHash(req.body.password).then(function (hash) {

                    var newUser = new userModel({
                        "name": req.body.name,
                        "email": req.body.email,
                        "password": hash,
                        "phone": req.body.phone,
                    })
                    newUser.save((err, data) => {
                        if (!err) {
                            res.send({
                                message: "user created"
                            })
                        } else {
                            console.log(err);
                            res.status(500).send({
                                message: "user create error, " + err
                            })
                        }
                    });
                })

            } else if (err) {
                res.status(500).send({
                    message: "db error"
                })
            } else {
                res.status(409).send({
                    message: "user already exist"
                })
            }
        })
    return;
})

app.post("/login", (req, res, next) => {

    if (!req.body.email || !req.body.password) {

        res.status(403).send(`
        please send email and passwod in json body.
            e.g:
            {
                "email": "ahmed@gmail.com",
                "password": "abc",
            }`)
        return;
    }

    userModel.findOne({ email: req.body.email },
        function (err, user) {
            if (err) {
                res.status(500).send({
                    message: "an error occured: " + JSON.stringify(err)
                });
            } else if (user) {

                bcrypt.varifyHash(req.body.password, user.password).then(isMatched => {
                    if (isMatched) {
                        console.log("matched");

                        var token =
                            jwt.sign({
                                id: user._id,
                                name: user.name,
                                email: user.email,
                            }, SERVER_SECRET)

                        res.cookie('jToken', token, {
                            maxAge: 86_400_000,
                            httpOnly: true
                        });

                        res.send({
                            message: "login success",
                            user: {
                                name: user.name,
                                email: user.email,
                                phone: user.phone,
                            }
                        });
                    } else {
                        console.log("not matched");
                        res.status(401).send({
                            message: "incorrect passsword"
                        })
                    }
                }).catch(e => {
                    console.log("error: ", e)
                })
            } else {
                res.status(403).send({
                    message: "user not found"
                });
            }
        });
})

app.use(function (req, res, next) {

    console.log("req.cookies: ", req.cookies);
    if (!req.cookies.jToken) {
        res.status(401).send("include http-only credentials with every request")
        return;
    }
    jwt.verify(req.cookies.jToken, SERVER_SECRET, function (err, decodedData) {
        if (!err) {

            const issueDate = decodedData.iat * 1000;
            const nowDate = new Date().getTime();
            const diff = nowDate - issueDate;

            if (diff > 300000) {
                res.status(401).send("token expired")
            } else {
                var token = jwt.sign({
                    id: decodedData.id,
                    name: decodedData.name,
                    email: decodedData.email,
                }, SERVER_SECRET)
                res.cookie('jToken', token, {
                    maxAge: 86_400_000,
                    httpOnly: true
                });
                req.body.jToken = decodedData
                next();
            }
        } else {
            res.status(401).send("invalid token")
        }
    });
})

const http = require("http").createServer(app);
var moment = require("moment");

var clientInfo = {};

var io = require("socket.io")(http);

function sendCurrentUsers(socket) {
    var info = clientInfo[socket.id];
    var users = [];
    if (typeof info === 'undefined') {
        return;
    }
    Object.keys(clientInfo).forEach(function (socketId) {
        var userinfo = clientInfo[socketId];
        if (info.room == userinfo.room) {
            users.push(userinfo.name);
        }

    });

    socket.emit("message", {
        name: "System",
        text: "Current Users : " + users.join(', '),
        timestamp: moment().valueOf()
    });

}

io.on("connection", function (socket) {
    console.log("User is connected");

    socket.on("disconnect", function () {
        var userdata = clientInfo[socket.id];
        if (typeof (userdata !== undefined)) {
            socket.leave(userdata.room);
            socket.broadcast.to(userdata.room).emit("message", {
                text: userdata.name + " has left",
                name: "System",
                timestamp: moment().valueOf()
            });

            delete clientInfo[socket.id];

        }
    });

    socket.on('joinRoom', function (req) {
        clientInfo[socket.id] = req;
        socket.join(req.room);
        socket.broadcast.to(req.room).emit("message", {
            name: "System",
            text: req.name + ' has joined',
            timestamp: moment().valueOf()
        });

    });

    socket.on('typing', function (message) {
        socket.broadcast.to(clientInfo[socket.id].room).emit("typing", message);
    });

    socket.on("userSeen", function (msg) {
        socket.broadcast.to(clientInfo[socket.id].room).emit("userSeen", msg);

    });

    socket.emit("message", {
        text: "Welcome !",
        timestamp: moment().valueOf(),
        name: "System"
    });

    socket.on("message", function (message) {
        console.log("Message Received : " + message.text);
        if (message.text === "@currentUsers") {
            sendCurrentUsers(socket);
        } else {
            message.timestamp = moment().valueOf();
            socket.broadcast.to(clientInfo[socket.id].room).emit("message", message);
        }

    });
});


const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
    console.log("server is running on: ", PORT);
})