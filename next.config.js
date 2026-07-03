/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfkit', 'imapflow', 'mailparser', 'nodemailer', 'mysql2'],
  },
};

module.exports = nextConfig;
