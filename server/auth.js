import crypto from 'crypto';
import { sendVerificationEmail } from './email.js';
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
  const verificationToken = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      passwordSalt: salt,
      emailVerified: false,
      verificationToken
    }
  });
  // Send verification email (await to ensure it completes before response)
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (err) {
    console.error('Failed to send verification email', err);
  }
  return { id: user.id, email: user.email, name: user.name, balanceCents: user.balanceCents || 0, emailVerified: user.emailVerified };
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
  if (!user.emailVerified) {
    // For legacy accounts without a token, generate one and send
    if (!user.verificationToken) {
      const token = crypto.randomUUID();
      console.log('[auth] generating verification token for legacy user', user.email);
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationToken: token }
      });
      try {
        await sendVerificationEmail(user.email, token);
      } catch (err) {
        console.error('Failed to send verification email', err);
      }
    } else {
      // Resend existing token for convenience
      console.log('[auth] resending verification token to', user.email);
      try {
        await sendVerificationEmail(user.email, user.verificationToken);
      } catch (err) {
        console.error('Failed to send verification email', err);
      }
    }
    throw new Error('Please verify your email before logging in. A verification email has been sent.');
  }
  return { id: user.id, email: user.email, name: user.name, balanceCents: user.balanceCents || 0, token: makeToken(), emailVerified: user.emailVerified };
};

export const resendVerification = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerified) {
    return { ok: true, sent: false };
  }
  let token = user.verificationToken;
  if (!token) {
    token = crypto.randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken: token }
    });
  }
  try {
    await sendVerificationEmail(user.email, token);
  } catch (err) {
    console.error('Failed to send verification email', err);
  }
  return { ok: true, sent: true };
};
