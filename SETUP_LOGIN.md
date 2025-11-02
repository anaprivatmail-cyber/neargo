# NearGo - Login/Registration Setup Guide

## Required Environment Variables

### Supabase Configuration
These variables must be set in your Netlify environment (Site Settings → Environment Variables):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Email Configuration (Optional but recommended for email verification)
For sending verification codes via email:

```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password
EMAIL_FROM=NearGo <info@getneargo.com>
```

Popular SMTP providers:
- **Gmail**: smtp.gmail.com (port 587) - requires App Password
- **SendGrid**: smtp.sendgrid.net (port 587)
- **Mailgun**: smtp.mailgun.org (port 587)

### SMS Configuration (Optional for SMS verification)
For sending verification codes via SMS using Twilio:

```
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_FROM_NUMBER=+1234567890
```

## Database Schema

### Required Table: `verif_codes`

Create this table in your Supabase database:

```sql
CREATE TABLE verif_codes (
  id SERIAL PRIMARY KEY,
  email TEXT,
  phone TEXT,
  code TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX idx_verif_codes_email ON verif_codes(email);
CREATE INDEX idx_verif_codes_phone ON verif_codes(phone);
CREATE INDEX idx_verif_codes_code ON verif_codes(code);
CREATE INDEX idx_verif_codes_created_at ON verif_codes(created_at);
```

## Frontend Files

### Main Login/Registration Page
- **File**: `/login.html`
- **Features**:
  - Email/password login
  - Registration with SMS or email verification
  - Password validation (min 6 characters)
  - Country code selection for phone numbers
  - Real-time validation feedback
  - Color-coded error messages

## Backend Functions

### 1. Send Verification Code
- **File**: `netlify/functions/send-code.js`
- **Endpoint**: `/.netlify/functions/send-code`
- **Method**: POST
- **Request Body**:
  ```json
  {
    "method": "email" | "sms",
    "email": "user@example.com",  // for email method
    "phone": "1234567890",         // for SMS method
    "countryCode": "+386"          // for SMS method
  }
  ```
- **Response**:
  ```json
  {
    "ok": true,
    "codeSent": true,
    "method": "email" | "sms"
  }
  ```

### 2. Verify Code
- **File**: `netlify/functions/verify-code.js`
- **Endpoint**: `/.netlify/functions/verify-code`
- **Method**: POST
- **Request Body**:
  ```json
  {
    "email": "user@example.com",  // for email verification
    "phone": "1234567890",        // for SMS verification
    "countryCode": "+386",        // for SMS verification
    "code": "123456"
  }
  ```
- **Response**:
  ```json
  {
    "ok": true,
    "verified": true,
    "redirect": "/my.html"
  }
  ```

### 3. Email Sender (Helper)
- **File**: `netlify/functions/mailer.cjs`
- **Purpose**: Centralized email sending utility using nodemailer
- **Used by**: send-code.js

## User Flow

### Registration Flow
1. User fills in: first name, last name, country code, phone, email, password
2. User selects verification method (SMS or Email)
3. User clicks "Preveri s SMS kodo" or "Preveri z email kodo" button
4. System sends verification code
5. User enters received code
6. System verifies code
7. System creates Supabase account with user metadata
8. User is redirected to /my.html

### Login Flow
1. User enters email and password
2. User clicks "Prijava"
3. System authenticates with Supabase
4. User is redirected based on ?redirect parameter (default: /my.html)

## Password Requirements
- Minimum 6 characters
- Real-time validation feedback shown as user types
- Visual indicators (✗ red / ✓ green)

## Testing

### Development Testing (Without SMTP/Twilio)
If SMTP or Twilio credentials are not configured:
- Verification codes are logged to the console
- Check Netlify function logs to retrieve codes during testing

### Production Testing
1. Set up SMTP credentials for email verification
2. (Optional) Set up Twilio credentials for SMS verification
3. Test complete registration flow
4. Verify emails are received and codes work
5. Test error scenarios (invalid code, expired code)

## Error Handling

The system provides clear, color-coded feedback:
- **Blue (#0bbbd6)**: Info messages (e.g., "Pošiljam kodo...")
- **Green (#11a67a)**: Success messages (e.g., "✅ Registracija uspešna!")
- **Red (#d64c4c)**: Error messages (e.g., "Koda ni pravilna")

## Security Notes

1. **Code Expiration**: Verification codes expire after 10 minutes
2. **One-Time Use**: Codes can only be used once
3. **Service Role Key**: Keep SUPABASE_SERVICE_ROLE_KEY secret (server-side only)
4. **Password Storage**: Handled securely by Supabase Auth
5. **HTTPS**: Always use HTTPS in production

## Troubleshooting

### Codes Not Arriving
- Check Netlify function logs for errors
- Verify SMTP/Twilio credentials are correct
- Check spam/junk folders for email codes
- Ensure phone number format includes country code

### Database Errors
- Verify `verif_codes` table exists
- Check Supabase permissions and RLS policies
- Ensure SUPABASE_SERVICE_ROLE_KEY is set correctly

### Authentication Errors
- Check SUPABASE_URL and SUPABASE_ANON_KEY in frontend
- Verify Supabase Auth is enabled for email provider
- Check Supabase Auth logs for detailed errors

## Next Steps

After setup:
1. Configure environment variables in Netlify
2. Create `verif_codes` table in Supabase
3. Test registration with email verification
4. (Optional) Configure Twilio for SMS verification
5. Enable Google OAuth in Supabase for Google sign-in
6. Customize email templates in `send-code.js`
