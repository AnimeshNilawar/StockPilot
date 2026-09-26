class ConsoleEmailProvider {
  async sendPasswordResetOtp({ to, otp, expiresInMinutes }) {
    console.log(`[DEV ONLY] OTP for ${to}: ${otp}`);
    return true;
  }
}

module.exports = ConsoleEmailProvider;
