class ConsoleEmailProvider {
  async sendPasswordResetOtp({ to, otp, expiresInMinutes }) {
    console.log(`[DEV ONLY] OTP for ${to}: ${otp} (expires in ${expiresInMinutes} minutes)`);
    return true;
  }
}

module.exports = ConsoleEmailProvider;
