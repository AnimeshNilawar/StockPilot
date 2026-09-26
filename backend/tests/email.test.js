const { env } = require('../src/config/env');
const ConsoleEmailProvider = require('../src/services/email/providers/console-email.provider');
const SmtpEmailProvider = require('../src/services/email/providers/smtp-email.provider');
const nodemailer = require('nodemailer');

jest.mock('nodemailer');

describe('Email Service & Providers', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  describe('ConsoleEmailProvider (Test 1)', () => {
    it('should log OTP to console and succeed', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const provider = new ConsoleEmailProvider();
      
      const result = await provider.sendPasswordResetOtp({ to: 'test@example.com', otp: '123456', expiresInMinutes: 10 });
      
      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('[DEV ONLY] OTP for test@example.com: 123456');
      consoleSpy.mockRestore();
    });
  });

  describe('SmtpEmailProvider (Test 2)', () => {
    it('should send email using nodemailer', async () => {
      env.SMTP_USER = 'test@gmail.com';
      env.SMTP_PASSWORD = 'password123';
      env.SMTP_FROM = 'test@gmail.com';
      
      const mockSendMail = jest.fn().mockResolvedValue(true);
      nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

      const provider = new SmtpEmailProvider();
      const result = await provider.sendPasswordResetOtp({ to: 'user@test.com', otp: '654321', expiresInMinutes: 10 });
      
      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      
      const mailArgs = mockSendMail.mock.calls[0][0];
      expect(mailArgs.to).toBe('user@test.com');
      expect(mailArgs.subject).toBe('StockPilot Password Reset OTP');
      expect(mailArgs.text).toContain('654321');
      expect(mailArgs.text).toContain('expires in 10 minutes');
    });
  });

  describe('SmtpEmailProvider Failure (Test 3)', () => {
    it('should safely throw generic error when SMTP fails', async () => {
      env.SMTP_USER = 'test@gmail.com';
      env.SMTP_PASSWORD = 'password123';
      
      const mockSendMail = jest.fn().mockRejectedValue(new Error('SMTP Auth failed horribly'));
      nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const provider = new SmtpEmailProvider();
      
      await expect(provider.sendPasswordResetOtp({ to: 'user@test.com', otp: '654321', expiresInMinutes: 10 }))
        .rejects.toThrow('Email delivery failed');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith('SMTP Delivery failed:', 'SMTP Auth failed horribly');
      consoleErrorSpy.mockRestore();
    });
  });

  describe('SmtpEmailProvider Missing Config (Test 4)', () => {
    it('should throw error during initialization if config is missing', () => {
      env.SMTP_USER = '';
      env.SMTP_PASSWORD = '';
      
      expect(() => new SmtpEmailProvider()).toThrow('SMTP configuration is missing');
    });
  });
});
