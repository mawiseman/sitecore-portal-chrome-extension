/**
 * Simple test to verify secure interceptor functionality
 * This can be run in the browser console for testing
 */

function testSecureInterceptor() {
  console.log('🧪 Testing Secure Request Interceptor...');
  
  // Test 1: Check if interceptor is available
  if (typeof window.sitecoreSecureInterceptor === 'undefined') {
    console.error('❌ Secure interceptor not found');
    return false;
  }
  
  const interceptor = window.sitecoreSecureInterceptor;
  console.log('✅ Secure interceptor found');
  
  // Test 2: Check interceptor status
  const status = interceptor.getStatus ? interceptor.getStatus() : 'Status method not available';
  console.log('📊 Interceptor status:', status);
  
  // Test 3: Test fetch interception (safe test)
  console.log('🔍 Testing fetch interception...');
  const originalFetch = window.fetch;
  
  if (typeof originalFetch === 'function') {
    // Check if fetch appears to be wrapped
    const fetchStr = originalFetch.toString();
    const isWrapped = fetchStr.includes('secureInterceptedFetch') || 
                     fetchStr.includes('shouldInterceptUrl') ||
                     fetchStr.length > 100; // Original fetch is much shorter
    
    console.log(isWrapped ? '✅ Fetch appears to be intercepted' : '⚠️ Fetch may not be intercepted');
  }
  
  // Test 4: Test XMLHttpRequest interception
  console.log('🔍 Testing XMLHttpRequest interception...');
  try {
    const xhr = new XMLHttpRequest();
    
    // Check if XHR constructor is wrapped
    const constructorStr = XMLHttpRequest.toString();
    const isConstructorWrapped = constructorStr.includes('SecureXMLHttpRequest') || 
                                constructorStr.includes('originalXHR');
    
    if (isConstructorWrapped) {
      console.log('✅ XMLHttpRequest constructor appears to be wrapped');
    } else {
      // Check if prototype methods are wrapped
      const openStr = XMLHttpRequest.prototype.open.toString();
      const sendStr = XMLHttpRequest.prototype.send.toString();
      
      const isPrototypeWrapped = openStr.includes('_secureInterceptor') || 
                                sendStr.includes('_secureInterceptor');
      
      console.log(isPrototypeWrapped ? 
        '✅ XMLHttpRequest prototype appears to be intercepted' : 
        '⚠️ XMLHttpRequest may not be intercepted'
      );
    }
    
    // Test creating an XHR instance
    if (typeof xhr.open === 'function' && typeof xhr.send === 'function') {
      console.log('✅ XMLHttpRequest instance created successfully');
    }
    
  } catch (error) {
    console.error('❌ Error testing XMLHttpRequest:', error.message);
  }
  
  // Test 5: Test integrity check
  console.log('🔍 Testing integrity verification...');
  if (typeof interceptor.checkIntegrity === 'function') {
    const integrityResult = interceptor.checkIntegrity();
    console.log(`${integrityResult ? '✅' : '⚠️'} Integrity check: ${integrityResult}`);
  } else {
    console.log('⚠️ Integrity check method not available');
  }
  
  console.log('🧪 Test completed!');
  return true;
}

// Auto-run test if in browser
if (typeof window !== 'undefined') {
  console.log('🔧 Secure interceptor test loaded. Run testSecureInterceptor() to test.');
}