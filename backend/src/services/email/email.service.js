const { env } = require('../../config/env');
const ConsoleEmailProvider = require('./providers/console-email.provider');
const SmtpEmailProvider = require('./providers/smtp-email.provider');

class EmailService {
  constructor() {
    if (env.OTP_DELIVERY_MODE === 'smtp') {
      this.provider = new SmtpEmailProvider();
    } else {
      this.provider = new ConsoleEmailProvider();
    }
  }

  async sendPasswordResetOtp({ to, otp, expiresInMinutes }) {
    return await this.provider.sendPasswordResetOtp({ to, otp, expiresInMinutes });
  }
}

// Export a singleton instance
module.exports = new EmailService();
