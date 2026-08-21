const fs = require('fs');

const coreCode = fs.readFileSync('./utils/core.js', 'utf8');

console.log(coreCode.indexOf("replace(/[&<>\"]/g"));
console.log(coreCode.indexOf("replace(/[&<>\"']/g"));
