# Apple App Store & Google Play Store Compliance Guide

## 🍎 Apple App Store Requirements

### 1. App Store Connect Setup
1. **Create In-App Purchase Products**:
   - `premium_monthly` - Premium subscription (monthly)
   - `provider_grow_monthly` - Provider Grow package (monthly)  
   - `provider_pro_monthly` - Provider Pro package (monthly)

2. **Configure Subscriptions**:
   - Set up auto-renewable subscriptions
   - Add localized descriptions in Slovenian and English
   - Set pricing tiers (Premium: €5/month, Grow: TBD, Pro: TBD)

3. **App Store Server Notifications**:
   - Set notification URL to: `https://neargo.netlify.app/.netlify/functions/iap-apple-verify`
   - Enable all notification types (SUBSCRIBED, DID_RENEW, EXPIRED, etc.)

### 2. iOS App Implementation
Add this JavaScript interface to your iOS WebView:

```swift
// iOS WebView Message Handler
func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "iOS" {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        
        if action == "purchaseSubscription" {
            let productId = body["productId"] as? String ?? ""
            let type = body["type"] as? String ?? ""
            
            // Start StoreKit purchase flow
            purchaseProduct(productId: productId, type: type)
        }
    }
}
```

### 3. App Store Review Guidelines Compliance
- ✅ Use only Apple's In-App Purchase for digital subscriptions
- ✅ No external payment links on iOS
- ✅ Clear subscription terms and pricing
- ✅ Easy cancellation process through iOS Settings

---

## 🤖 Google Play Store Requirements

### 1. Google Play Console Setup
1. **Create Subscription Products**:
   - `premium_monthly` - Premium subscription (monthly)
   - `provider_grow_monthly` - Provider Grow package (monthly)
   - `provider_pro_monthly` - Provider Pro package (monthly)

2. **Configure Play Billing**:
   - Set up auto-renewable subscriptions
   - Add localized descriptions
   - Set pricing in EUR

3. **Real-time Developer Notifications (RTDN)**:
   - Set notification URL to: `https://neargo.netlify.app/.netlify/functions/iap-google-verify`
   - Configure Cloud Pub/Sub topic

### 2. Android App Implementation  
Add this JavaScript interface to your Android WebView:

```java
// Android WebView JavaScript Interface
@JavascriptInterface
public void purchaseSubscription(String productId, String type, String plan) {
    // Start Google Play Billing flow
    billingClient.launchBillingFlow(activity, 
        BillingFlowParams.newBuilder()
            .setSkuDetails(skuDetails)
            .build());
}
```

### 3. Play Store Policy Compliance
- ✅ Use only Google Play Billing for digital subscriptions
- ✅ No external payment links on Android
- ✅ Clear subscription terms and auto-renewal disclosure
- ✅ Easy cancellation through Play Store

---

## 🌐 Web/Desktop (Stripe) Compliance

### 1. EU Regulations (GDPR, PSD2)
- ✅ Clear pricing display in EUR
- ✅ Strong Customer Authentication (SCA) via Stripe
- ✅ GDPR-compliant data processing
- ✅ Right to cancel subscriptions

### 2. Implementation
```javascript
// Automatically detects platform and routes to appropriate payment method
function detectPlatform() {
  // iOS: Use Apple IAP
  // Android: Use Google Play Billing  
  // Web/Desktop: Use Stripe
}
```

---

## 🔧 Environment Variables Required

Add these to your Netlify environment:

```bash
# Apple App Store
APPLE_APP_BUNDLE_ID=com.neargo.app
APPLE_PRIVATE_KEY_ID=ABC123
APPLE_ISSUER_ID=abc-123-def
APPLE_TEAM_ID=ABC123DEF

# Google Play Store  
GOOGLE_PLAY_PACKAGE_NAME=com.neargo.app
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
```

---

## 📋 Testing Checklist

### Before App Store Submission:
- [ ] Test IAP in sandbox environment
- [ ] Verify subscription renewals work
- [ ] Test cancellation flow
- [ ] Verify webhook notifications
- [ ] Test restore purchases functionality

### Before Play Store Submission:
- [ ] Test with Play Console testing accounts
- [ ] Verify subscription management
- [ ] Test RTDN webhook delivery
- [ ] Verify billing compliance

### Web Testing:
- [ ] Test Stripe payment flow
- [ ] Verify webhook handling
- [ ] Test subscription management
- [ ] Verify GDPR compliance

---

## 🚀 Deployment Steps

1. **Deploy Netlify Functions**: Already configured
2. **Set Environment Variables**: Add all required keys
3. **Run Supabase Setup**: Execute `supabase-setup.sql`
4. **Configure Webhooks**: Set URLs in Apple/Google consoles
5. **Test All Flows**: Verify each payment platform works
6. **Submit Apps**: Follow platform-specific review processes