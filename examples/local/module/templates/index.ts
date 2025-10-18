import * as fs from 'fs';
import * as path from 'path';
export default {
    example: fs.readFileSync(path.join(__dirname, 'example.md'), 'utf-8')
};