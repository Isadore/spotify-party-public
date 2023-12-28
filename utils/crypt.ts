import crypto from "crypto";

export function encrypt(str: string) {
    let iv = crypto.randomBytes(16);
    let cipher = crypto.createCipheriv('aes-256-cbc', process.env.ENCRYPTION_KEY, iv);
    let crypted = cipher.update(String(str), 'utf8', 'hex');
    crypted += cipher.final('hex');
    return Buffer.from(iv).toString('hex') + crypted;
};

export function decrypt(str: string) {
    let iv = Buffer.from(str.substring(0, 32), 'hex');
    str = String(str).substring(32, str.length);
    let decipher = crypto.createDecipheriv('aes-256-cbc', process.env.ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(String(str), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};