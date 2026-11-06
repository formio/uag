const fs = require('fs');
const path = require('path');
module.exports = {
    example: fs.readFileSync(path.join(__dirname, 'example.md'), 'utf-8')
};