const nodemailer = require('nodemailer');
const { env } = require('../../../config/env');

class SmtpEmailProvider {
  constructor() {
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
      throw new Error('SMTP configuration is missing (SMTP_USER or SMTP_PASSWORD). Please check your environment variables.');
    }

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });

    this.from = env.SMTP_FROM || env.SMTP_USER;
  }

  async sendPasswordResetOtp({ to, otp, expiresInMinutes }) {
    const mailOptions = {
      from: `"StockPilot" <${this.from}>`,
      to,
      subject: 'StockPilot Password Reset OTP',
      text: `StockPilot Password Reset\n\nWe received a request to reset your StockPilot password.\n\nYour verification code is:\n\n${otp}\n\nThis code expires in ${expiresInMinutes} minutes.\n\nIf you did not request this password reset, you can ignore this email.\n\nDo not share this code with anyone.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e40af;">StockPilot Password Reset</h2>
          <p>We received a request to reset your StockPilot password.</p>
          <p>Your verification code is:</p>
          <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
          <p style="color: #64748b; font-size: 14px; margin-top: 30px;">
            If you did not request this password reset, you can ignore this email.<br/>
            <strong>Do not share this code with anyone.</strong>
          </p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      console.error('SMTP Delivery failed:', error.message);
      // We don't expose error details to avoid leaking secrets/internals
      throw new Error('Email delivery failed');
    }
  }
}

module.exports = SmtpEmailProvider;
