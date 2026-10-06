#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtectionScope {
    CurrentUser,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipboardProtectionError {
    Unavailable,
    InvalidPayload,
}

pub trait TextProtector: Send + Sync {
    fn protect(
        &self,
        scope: ProtectionScope,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError>;

    fn unprotect(
        &self,
        scope: ProtectionScope,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtectedClipboardText {
    pub version: u8,
    pub ciphertext: Vec<u8>,
}

pub fn protect_text(
    protector: &(impl TextProtector + ?Sized),
    plaintext: &str,
) -> Result<ProtectedClipboardText, ClipboardProtectionError> {
    if plaintext.is_empty() {
        return Err(ClipboardProtectionError::InvalidPayload);
    }
    let ciphertext = protector.protect(ProtectionScope::CurrentUser, plaintext.as_bytes())?;
    if ciphertext.is_empty() {
        return Err(ClipboardProtectionError::InvalidPayload);
    }
    Ok(ProtectedClipboardText {
        version: 1,
        ciphertext,
    })
}

pub fn unprotect_text(
    protector: &(impl TextProtector + ?Sized),
    protected: &ProtectedClipboardText,
) -> Result<String, ClipboardProtectionError> {
    if protected.version != 1 || protected.ciphertext.is_empty() {
        return Err(ClipboardProtectionError::InvalidPayload);
    }
    let plaintext = protector.unprotect(ProtectionScope::CurrentUser, &protected.ciphertext)?;
    if plaintext.is_empty() {
        return Err(ClipboardProtectionError::InvalidPayload);
    }
    String::from_utf8(plaintext).map_err(|_| ClipboardProtectionError::InvalidPayload)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsDpapiProtector;

#[cfg(target_os = "windows")]
impl TextProtector for WindowsDpapiProtector {
    fn protect(
        &self,
        scope: ProtectionScope,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{
            CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };

        if scope != ProtectionScope::CurrentUser || plaintext.is_empty() {
            return Err(ClipboardProtectionError::InvalidPayload);
        }
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(plaintext.len())
                .map_err(|_| ClipboardProtectionError::InvalidPayload)?,
            pbData: plaintext.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &mut input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|_| ClipboardProtectionError::Unavailable)?;
            copy_and_free_dpapi_blob(output, HLOCAL(output.pbData.cast()))
        }
    }

    fn unprotect(
        &self,
        scope: ProtectionScope,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        use windows::Win32::Foundation::HLOCAL;
        use windows::Win32::Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };

        if scope != ProtectionScope::CurrentUser || ciphertext.is_empty() {
            return Err(ClipboardProtectionError::InvalidPayload);
        }
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(ciphertext.len())
                .map_err(|_| ClipboardProtectionError::InvalidPayload)?,
            pbData: ciphertext.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &mut input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|_| ClipboardProtectionError::InvalidPayload)?;
            copy_and_free_dpapi_blob(output, HLOCAL(output.pbData.cast()))
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn copy_and_free_dpapi_blob(
    blob: windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
    allocation: windows::Win32::Foundation::HLOCAL,
) -> Result<Vec<u8>, ClipboardProtectionError> {
    use windows::Win32::Foundation::LocalFree;

    if blob.cbData == 0 || blob.pbData.is_null() {
        let _ = unsafe { LocalFree(Some(allocation)) };
        return Err(ClipboardProtectionError::InvalidPayload);
    }
    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
    let _ = unsafe { LocalFree(Some(allocation)) };
    Ok(bytes)
}

#[cfg(not(target_os = "windows"))]
impl TextProtector for WindowsDpapiProtector {
    fn protect(
        &self,
        _scope: ProtectionScope,
        _plaintext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        Err(ClipboardProtectionError::Unavailable)
    }

    fn unprotect(
        &self,
        _scope: ProtectionScope,
        _ciphertext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        Err(ClipboardProtectionError::Unavailable)
    }
}
