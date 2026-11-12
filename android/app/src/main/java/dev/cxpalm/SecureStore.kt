package dev.cxpalm

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("cxpalm-v1", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("cxpalm-v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("cxpalm-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun get(name: String): String? = prefs.getString(name, null)?.let { unseal(name,it) }
    @Synchronized fun unseal(name: String, encoded: String): String {
        return String(unsealBytes(name, Base64.decode(encoded, Base64.NO_WRAP)), Charsets.UTF_8)
    }
    @Synchronized fun unsealBytes(name: String, bytes: ByteArray): ByteArray {
        require(bytes.size >= 28) { "Encrypted local state is invalid" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray())
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
    }
    @Synchronized fun put(name: String, value: String?) {
        if (value == null) { check(prefs.edit().remove(name).commit()); return }
        check(prefs.edit().putString(name, seal(name,value)).commit())
    }
    @Synchronized fun seal(name: String, value: String): String {
        return Base64.encodeToString(sealBytes(name, value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    @Synchronized fun sealBytes(name: String, value: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(name.toByteArray())
        return cipher.iv + cipher.doFinal(value)
    }
}
