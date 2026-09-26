const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { env } = require('./config/env');
const { corsOptions } = require('./config/cors');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use('/api/v1', routes);

app.use(notFound);

app.use(errorHandler);

module.exports = app;
