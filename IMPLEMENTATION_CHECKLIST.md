# Frontend and Backend Implementation Checklist for User Registration

## Summary
This document provides a comprehensive list of all code changes needed for both frontend and backend to implement a fully functional user registration and login system with SMS/email verification.

---

## Backend Changes (Netlify Functions)

### ✅ 1. Create `netlify/functions/send-code.js`
**Purpose**: Send verification code via SMS or email

**Key Features**:
- Generates 6-digit verification code
- Stores code in Supabase `verif_codes` table
- Sends code via email (using mailer.cjs) or SMS (using Twilio)
- Returns success/error response

**Dependencies**:
- `@supabase/supabase-js`
- `nodemailer` (for email)
- `twilio` (optional, for SMS)

**Environment Variables Required**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (for email)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (for SMS)

**Status**: ✅ Created

---

### ✅ 2. Create `netlify/functions/mailer.cjs`
**Purpose**: Centralized email sending utility

**Key Features**:
- Uses nodemailer with SMTP configuration
- Handles email formatting
- Error handling for missing SMTP config

**Environment Variables Required**:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`

**Status**: ✅ Created

---

### ✅ 3. Update `netlify/functions/verify-code.js`
**Purpose**: Verify SMS/email codes and mark as used

**Changes Made**:
- Improved error handling with try/catch
- Better country code handling for phone numbers
- Proper response formatting with detailed error messages
- Automatic code expiration (10 minutes)

**Key Features**:
- Validates code against database
- Checks code hasn't been used
- Checks code isn't expired (< 10 minutes old)
- Marks code as used after verification
- Returns verified status

**Status**: ✅ Updated

---

## Frontend Changes

### ✅ 4. Update `login.html`
**Purpose**: User login and registration interface

**Changes Made**:

#### a. Password Validation UI
```html
<div id="passwordRequirements" style="margin-top:6px;font-size:13px;color:#5b6b7b;display:none;">
  <div id="reqLength" style="color:#d64c4c;">✗ Vsaj 6 znakov</div>
</div>
```
- Real-time password validation
- Visual feedback (✗ red / ✓ green)
- Shows requirements on focus, hides when valid

#### b. Improved Error Messaging
- Color-coded messages:
  - **Blue (#0bbbd6)**: Info/loading states
  - **Green (#11a67a)**: Success messages
  - **Red (#d64c4c)**: Error messages

#### c. Enhanced Code Sending Flow
- Clear button states (selected/unselected)
- Better validation before sending codes
- Informative messages about where code was sent
- Proper error handling from backend

#### d. Login Form Improvements
- Added password length validation (min 6 characters)
- Better error messages
- Color-coded feedback

**Status**: ✅ Updated

---

## Database Changes

### ✅ 5. Create Database Schema (`database_schema.sql`)
**Purpose**: Set up required database tables and policies

**Tables Created**:

#### a. `verif_codes` Table
```sql
CREATE TABLE verif_codes (
  id SERIAL PRIMARY KEY,
  email TEXT,
  phone TEXT,
  code TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes**:
- `idx_verif_codes_email`
- `idx_verif_codes_phone`
- `idx_verif_codes_code`
- `idx_verif_codes_created_at`
- `idx_verif_codes_used`

#### b. `profiles` Table (Optional)
```sql
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Triggers**:
- `on_auth_user_created`: Automatically creates profile when user signs up

**RLS Policies**:
- Service role has full access to `verif_codes`
- Public/anon have no access to `verif_codes`
- Users can view/update their own profile

**Utility Functions**:
- `cleanup_old_verif_codes()`: Removes codes older than 24 hours

**Status**: ✅ Created

---

## Documentation

### ✅ 6. Create `SETUP_LOGIN.md`
**Purpose**: Comprehensive setup guide

**Sections**:
- Environment variables configuration
- Database schema setup
- Frontend/backend file descriptions
- User flow diagrams
- Testing instructions
- Error handling guide
- Security notes
- Troubleshooting tips

**Status**: ✅ Created

---

## Configuration Required

### Environment Variables (Set in Netlify)

#### Required:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### For Email Verification:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=NearGo <info@getneargo.com>
```

#### For SMS Verification (Optional):
```env
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_FROM_NUMBER=+1234567890
```

---

## Testing Checklist

### ✅ Backend Testing

1. **Test send-code function**:
   ```bash
   # Test email code
   curl -X POST https://your-site.netlify.app/.netlify/functions/send-code \
     -H "Content-Type: application/json" \
     -d '{"method":"email","email":"test@example.com"}'
   
   # Test SMS code
   curl -X POST https://your-site.netlify.app/.netlify/functions/send-code \
     -H "Content-Type: application/json" \
     -d '{"method":"sms","phone":"1234567890","countryCode":"+386"}'
   ```

2. **Test verify-code function**:
   ```bash
   curl -X POST https://your-site.netlify.app/.netlify/functions/verify-code \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","code":"123456"}'
   ```

3. **Check Netlify function logs** for:
   - Successful code generation
   - Email/SMS sending confirmation
   - Database operations
   - Any error messages

### ✅ Frontend Testing

1. **Registration Flow**:
   - [ ] Fill all required fields
   - [ ] Validate phone number format
   - [ ] Validate email format
   - [ ] Test password validation (< 6 chars should show error)
   - [ ] Click "Preveri s SMS kodo" button
   - [ ] Verify code input field appears
   - [ ] Check SMS/email received
   - [ ] Enter correct code
   - [ ] Verify successful registration
   - [ ] Check redirect to /my.html

2. **Login Flow**:
   - [ ] Enter registered email and password
   - [ ] Verify color-coded feedback messages
   - [ ] Test wrong password (should show error)
   - [ ] Test correct credentials (should redirect)
   - [ ] Test redirect parameter (?redirect=premium)

3. **Error Scenarios**:
   - [ ] Empty form submission
   - [ ] Invalid email format
   - [ ] Invalid phone number
   - [ ] Password too short
   - [ ] Wrong verification code
   - [ ] Expired verification code
   - [ ] Already used verification code

### ✅ Database Testing

1. **Run database schema**:
   - [ ] Execute `database_schema.sql` in Supabase SQL Editor
   - [ ] Verify `verif_codes` table exists
   - [ ] Verify `profiles` table exists
   - [ ] Check indexes are created
   - [ ] Verify RLS policies are active

2. **Test data flow**:
   - [ ] Send verification code
   - [ ] Check code appears in `verif_codes` table
   - [ ] Verify code with correct value
   - [ ] Check `used` column updated to true
   - [ ] Complete registration
   - [ ] Check profile created in `profiles` table

---

## Implementation Summary

### Files Created:
1. ✅ `netlify/functions/send-code.js` - Backend: Send verification codes
2. ✅ `netlify/functions/mailer.cjs` - Backend: Email utility
3. ✅ `database_schema.sql` - Database: Schema and policies
4. ✅ `SETUP_LOGIN.md` - Documentation: Setup guide

### Files Updated:
1. ✅ `netlify/functions/verify-code.js` - Backend: Improved error handling
2. ✅ `login.html` - Frontend: Enhanced UI and validation

### Configuration Needed:
1. ⚠️ Set environment variables in Netlify
2. ⚠️ Run database schema in Supabase
3. ⚠️ Configure SMTP for email verification
4. ⚠️ (Optional) Configure Twilio for SMS

---

## Next Steps

1. **Deploy to Netlify**:
   ```bash
   git push origin main
   ```

2. **Configure Environment Variables**:
   - Go to Netlify Dashboard → Site Settings → Environment Variables
   - Add all required variables

3. **Set Up Database**:
   - Go to Supabase Dashboard → SQL Editor
   - Run `database_schema.sql`

4. **Test Everything**:
   - Test registration with email verification
   - Test registration with SMS verification (if configured)
   - Test login flow
   - Verify redirects work correctly

5. **Monitor**:
   - Check Netlify function logs
   - Monitor Supabase logs
   - Watch for errors in browser console

---

## Security Checklist

- [x] Verification codes expire after 10 minutes
- [x] Codes can only be used once
- [x] Service role key used server-side only
- [x] RLS policies prevent unauthorized access
- [x] Passwords stored securely by Supabase
- [x] HTTPS enforced in production
- [ ] Rate limiting on send-code endpoint (recommended)
- [ ] CAPTCHA on registration form (recommended for production)

---

## Support

If you encounter issues:

1. Check Netlify function logs
2. Check Supabase logs
3. Review `SETUP_LOGIN.md` for detailed troubleshooting
4. Verify all environment variables are set correctly
5. Ensure database schema is applied

---

**Status**: All code changes completed ✅
**Ready for**: Testing and deployment
**Last Updated**: November 2, 2024
