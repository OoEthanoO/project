import crypto from 'crypto';
import { prisma } from './prisma.js';

const hashPassword = (password, salt) =>
  crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');

const makeToken = () => crypto.randomUUID();

export const registerUser = async (email, password, name) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('User already exists');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      passwordSalt: salt
    }
  });
  return { id: user.id, email: user.email, name: user.name, balanceCents: user.balanceCents || 0, token: makeToken() };
};

export const loginUser = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Invalid credentials');
  }
  const computed = hashPassword(password, user.passwordSalt);
  if (!crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
    throw new Error('Invalid credentials');
  }
  return { id: user.id, email: user.email, name: user.name, balanceCents: user.balanceCents || 0, token: makeToken() };
};
