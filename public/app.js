'use strict';

(function () {
  const sessionState = {
    publicKey: '',
    privateKey: '',
    passphrase: '',
    userLabel: '',
    keyID: ''
  };

  const $ = (id) => document.getElementById(id);

  // ---------- Theme Toggle ----------
  const themeBtn = $('btn-theme');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeBtn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }
  applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  // ---------- Accessible Tab Switching ----------
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activateTab(tab) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((p) => {
      p.hidden = p.id !== tab.getAttribute('aria-controls');
    });
  }

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') nextIdx = 0;
      if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        tabs[nextIdx].focus();
        activateTab(tabs[nextIdx]);
      }
    });
  });

  // ---------- Shared UI Helpers ----------
  function showStatus(el, type, message) {
    el.className = `status-banner is-${type}`;
    el.textContent = message;
    el.hidden = false;
  }

  function clearStatus(el) {
    el.hidden = true;
    el.textContent = '';
  }

  function setLoading(btn, isLoading, defaultLabel, loadingLabel) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? loadingLabel : defaultLabel;
  }

  // Show/hide password fields
  document.querySelectorAll('.toggle-vis').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? 'Hide' : 'Show';
    });
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = $(btn.dataset.source).value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        $(btn.dataset.source).select();
        document.execCommand('copy');
      }
    });
  });

  // Download buttons
  document.querySelectorAll('.download-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = $(btn.dataset.source).value;
      if (!text) return;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = btn.dataset.filename || 'output.asc';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  });

  // Load text files into textareas
  document.querySelectorAll('.sr-file').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const content = await file.text();
      $(input.dataset.target).value = content;
      input.value = '';
    });
  });

  // ---------- Session Keyring Helpers ----------
  function updateSessionUI() {
    const pill = $('session-pill');
    if (!sessionState.publicKey) {
      pill.hidden = true;
      $('session-label').textContent = '';
      return;
    }
    pill.hidden = false;
    $('session-label').textContent = `${sessionState.userLabel} [${sessionState.keyID}]`;
  }

  $('btn-clear-session').addEventListener('click', () => {
    sessionState.publicKey = '';
    sessionState.privateKey = '';
    sessionState.passphrase = '';
    sessionState.userLabel = '';
    sessionState.keyID = '';
    updateSessionUI();
  });

  document.querySelectorAll('.load-session-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      if (btn.dataset.kind === 'public') {
        if (!sessionState.publicKey) {
          alert('No session key stored yet. Generate a key pair in Tab 1 first.');
          return;
        }
        target.value = sessionState.publicKey;
      } else {
        if (!sessionState.privateKey) {
          alert('No session private key stored yet. Generate a key pair in Tab 1 first.');
          return;
        }
        target.value = sessionState.privateKey;
        if (btn.dataset.passTarget) {
          $(btn.dataset.passTarget).value = sessionState.passphrase || '';
        }
      }
    });
  });

  // ---------- OpenPGP Helpers ----------
  async function unlockPrivateKey(armoredKey, passphrase) {
    const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredKey.trim() });
    if (privateKey.isDecrypted()) return privateKey;
    if (!passphrase) {
      throw new Error('This private key is protected by a passphrase. Please enter it.');
    }
    return openpgp.decryptKey({ privateKey, passphrase });
  }

  async function readMultiplePublicKeys(armoredText) {
    const blocks = armoredText.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g);
    if (!blocks || blocks.length === 0) {
      throw new Error('No valid PGP public key block found.');
    }
    const nested = await Promise.all(
      blocks.map((block) => openpgp.readKeys({ armoredKeys: block }))
    );
    return nested.flat();
  }

  function formatFingerprint(fp) {
    return fp.toUpperCase().replace(/(.{4})/g, '$1 ').trim();
  }

  // ---------- TAB 1: GENERATE KEYS ----------
  $('form-generate').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('gen-status');
    const outSection = $('gen-output');
    clearStatus(status);

    const name = $('gen-name').value.trim();
    const email = $('gen-email').value.trim();
    const passphrase = $('gen-passphrase').value;
    const algo = $('gen-algo').value;
    const expiry = Number($('gen-expiry').value) || 0;

    if (!name || !email) {
      showStatus(status, 'error', 'Please enter both Full Name and Email Address.');
      return;
    }

    const opts = {
      userIDs: [{ name, email }],
      keyExpirationTime: expiry,
      format: 'armored'
    };
    if (passphrase) opts.passphrase = passphrase;

    if (algo === 'ecc-curve25519') {
      opts.type = 'ecc';
      opts.curve = 'curve25519';
    } else if (algo === 'ecc-p256') {
      opts.type = 'ecc';
      opts.curve = 'nistP256';
    } else if (algo === 'rsa-2048') {
      opts.type = 'rsa';
      opts.rsaBits = 2048;
    } else {
      opts.type = 'rsa';
      opts.rsaBits = 4096;
    }

    const btn = $('btn-generate');
    setLoading(btn, true, 'Generate Key Pair', 'Generating...');
    try {
      const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey(opts);
      const keyObj = await openpgp.readKey({ armoredKey: publicKey });
      const fingerprint = formatFingerprint(keyObj.getFingerprint());
      const keyID = keyObj.getKeyID().toHex().toUpperCase();

      $('gen-fingerprint').textContent = fingerprint;
      $('gen-keyid').textContent = keyID;
      $('gen-out-pub').value = publicKey;
      $('gen-out-priv').value = privateKey;
      $('gen-out-rev').value = revocationCertificate;
      outSection.hidden = false;

      // Save into session memory automatically for convenient testing across tabs
      sessionState.publicKey = publicKey;
      sessionState.privateKey = privateKey;
      sessionState.passphrase = passphrase;
      sessionState.userLabel = `${name} <${email}>`;
      sessionState.keyID = keyID;
      updateSessionUI();

      showStatus(status, 'success', `Key pair generated (${algo}). Saved in session memory for quick testing across tabs.`);
    } catch (err) {
      outSection.hidden = true;
      showStatus(status, 'error', `Key generation failed: ${err.message}`);
    } finally {
      setLoading(btn, false, 'Generate Key Pair', 'Generating...');
    }
  });

  $('btn-use-generated').addEventListener('click', () => {
    const pub = $('gen-out-pub').value.trim();
    const priv = $('gen-out-priv').value.trim();
    if (!pub || !priv) return;
    sessionState.publicKey = pub;
    sessionState.privateKey = priv;
    sessionState.passphrase = $('gen-passphrase').value;
    sessionState.userLabel = `${$('gen-name').value.trim()} <${$('gen-email').value.trim()}>`;
    sessionState.keyID = $('gen-keyid').textContent;
    updateSessionUI();
    showStatus($('gen-status'), 'info', 'Keys kept in session memory. Click "Use Session Key" on other tabs.');
  });

  $('btn-gen-reset').addEventListener('click', () => {
    $('form-generate').reset();
    $('gen-output').hidden = true;
    clearStatus($('gen-status'));
  });

  // ---------- TAB 2: SIGN ----------
  $('form-sign').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('sign-status');
    const outSection = $('sign-output');
    clearStatus(status);

    const text = $('sign-message').value;
    const privArmored = $('sign-privkey').value.trim();
    const passphrase = $('sign-passphrase').value;
    const mode = $('sign-mode').value;

    if (!text) {
      showStatus(status, 'error', 'Please enter a message to sign.');
      return;
    }
    if (!privArmored) {
      showStatus(status, 'error', 'Please provide your private key.');
      return;
    }

    const btn = $('btn-sign');
    setLoading(btn, true, 'Sign Message', 'Signing...');
    try {
      const signingKey = await unlockPrivateKey(privArmored, passphrase);
      let signed;
      if (mode === 'cleartext') {
        const message = await openpgp.createCleartextMessage({ text });
        signed = await openpgp.sign({ message, signingKeys: signingKey });
      } else {
        const message = await openpgp.createMessage({ text });
        signed = await openpgp.sign({ message, signingKeys: signingKey, detached: true });
      }
      $('sign-out-text').value = signed;
      outSection.hidden = false;
      showStatus(status, 'success', mode === 'cleartext' ? 'Cleartext signed message created.' : 'Detached PGP signature created.');
    } catch (err) {
      outSection.hidden = true;
      showStatus(status, 'error', `Signing failed: ${err.message}`);
    } finally {
      setLoading(btn, false, 'Sign Message', 'Signing...');
    }
  });

  $('btn-sign-clear').addEventListener('click', () => {
    $('form-sign').reset();
    $('sign-output').hidden = true;
    clearStatus($('sign-status'));
  });

  // ---------- TAB 3: VERIFY ----------
  $('verify-mode').addEventListener('change', (e) => {
    const isDetached = e.target.value === 'detached';
    $('verify-original-wrap').hidden = !isDetached;
    const label = $('verify-sig-label');
    label.textContent = isDetached ? 'Detached Signature ' : 'Signed Message ';
    const reqSpan = document.createElement('span');
    reqSpan.className = 'req';
    reqSpan.setAttribute('aria-hidden', 'true');
    reqSpan.textContent = '*';
    label.appendChild(reqSpan);
    $('verify-signature').placeholder = isDetached
      ? '-----BEGIN PGP SIGNATURE-----'
      : '-----BEGIN PGP SIGNED MESSAGE-----';
  });

  $('form-verify').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('verify-status');
    const outSection = $('verify-output');
    clearStatus(status);

    const mode = $('verify-mode').value;
    const sigText = $('verify-signature').value.trim();
    const pubText = $('verify-pubkey').value.trim();
    const origText = $('verify-original-message').value;

    if (!sigText || !pubText) {
      showStatus(status, 'error', 'Please provide both the signed message/signature and the sender’s public key.');
      return;
    }
    if (mode === 'detached' && !origText) {
      showStatus(status, 'error', 'Please provide the original unsigned message for detached signature verification.');
      return;
    }

    const btn = $('btn-verify');
    setLoading(btn, true, 'Verify Signature', 'Verifying...');
    try {
      const verificationKeys = await readMultiplePublicKeys(pubText);
      let result;
      if (mode === 'cleartext') {
        const message = await openpgp.readCleartextMessage({ cleartextMessage: sigText });
        result = await openpgp.verify({ message, verificationKeys });
      } else {
        const message = await openpgp.createMessage({ text: origText });
        const signature = await openpgp.readSignature({ armoredSignature: sigText });
        result = await openpgp.verify({ message, signature, verificationKeys });
      }

      if (!result.signatures || result.signatures.length === 0) {
        throw new Error('No signatures found in input.');
      }

      const sigInfo = result.signatures[0];
      const keyIDHex = sigInfo.keyID.toHex().toUpperCase();
      const matchedKey = verificationKeys.find((k) =>
        k.getKeyIDs().some((id) => id.toHex().toUpperCase() === keyIDHex)
      );
      const userIDs = matchedKey ? matchedKey.getUserIDs().join(', ') : 'Unknown User ID';
      const fingerprint = matchedKey ? formatFingerprint(matchedKey.getFingerprint()) : 'N/A';

      const card = $('verify-result-card');
      const badge = $('verify-badge');
      const meta = $('verify-meta');
      const extractedWrap = $('verify-extracted-wrap');

      try {
        await sigInfo.verified;
        card.className = 'verify-card is-valid';
        badge.textContent = 'VALID SIGNATURE — Message integrity and sender confirmed.';
        meta.textContent = `Signer: ${userIDs} | Key ID: ${keyIDHex} | Fingerprint: ${fingerprint}`;
        showStatus(status, 'success', 'Signature verified successfully.');
      } catch (verifyErr) {
        card.className = 'verify-card is-invalid';
        badge.textContent = 'INVALID SIGNATURE — Message was modified or key does not match.';
        meta.textContent = `Key ID: ${keyIDHex} | Reason: ${verifyErr.message}`;
        showStatus(status, 'error', 'Signature verification failed.');
      }

      if (mode === 'cleartext' && typeof result.data === 'string') {
        $('verify-extracted-text').value = result.data;
        extractedWrap.hidden = false;
      } else {
        extractedWrap.hidden = true;
      }
      outSection.hidden = false;
    } catch (err) {
      outSection.hidden = true;
      showStatus(status, 'error', `Verification error: ${err.message}`);
    } finally {
      setLoading(btn, false, 'Verify Signature', 'Verifying...');
    }
  });

  $('btn-verify-clear').addEventListener('click', () => {
    $('form-verify').reset();
    $('verify-original-wrap').hidden = true;
    $('verify-output').hidden = true;
    clearStatus($('verify-status'));
  });

  // ---------- TAB 4: ENCRYPT ----------
  $('form-encrypt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('enc-status');
    const outSection = $('enc-output');
    clearStatus(status);

    const text = $('enc-message').value;
    const pubText = $('enc-pubkey').value.trim();
    const symPass = $('enc-sym-pass').value;
    const signPriv = $('enc-sign-privkey').value.trim();
    const signPass = $('enc-sign-passphrase').value;

    if (!text) {
      showStatus(status, 'error', 'Please enter a message to encrypt.');
      return;
    }
    if (!pubText && !symPass) {
      showStatus(status, 'error', 'Provide at least one Recipient Public Key or a Symmetric Password.');
      return;
    }

    const btn = $('btn-encrypt');
    setLoading(btn, true, 'Encrypt Message', 'Encrypting...');
    try {
      const message = await openpgp.createMessage({ text });
      const encOpts = { message };

      if (pubText) {
        encOpts.encryptionKeys = await readMultiplePublicKeys(pubText);
      }
      if (symPass) {
        encOpts.passwords = [symPass];
      }
      if (signPriv) {
        encOpts.signingKeys = await unlockPrivateKey(signPriv, signPass);
      }

      const encrypted = await openpgp.encrypt(encOpts);
      $('enc-out-text').value = encrypted;
      outSection.hidden = false;
      showStatus(
        status,
        'success',
        signPriv ? 'Message encrypted and signed successfully.' : 'Message encrypted successfully.'
      );
    } catch (err) {
      outSection.hidden = true;
      showStatus(status, 'error', `Encryption failed: ${err.message}`);
    } finally {
      setLoading(btn, false, 'Encrypt Message', 'Encrypting...');
    }
  });

  $('btn-enc-clear').addEventListener('click', () => {
    $('form-encrypt').reset();
    $('enc-output').hidden = true;
    clearStatus($('enc-status'));
  });

  // ---------- TAB 5: DECRYPT ----------
  $('form-decrypt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('dec-status');
    const outSection = $('dec-output');
    clearStatus(status);

    const armoredMessage = $('dec-message').value.trim();
    const privText = $('dec-privkey').value.trim();
    const passphrase = $('dec-passphrase').value;
    const verifyPubText = $('dec-verify-pubkey').value.trim();

    if (!armoredMessage) {
      showStatus(status, 'error', 'Please paste an encrypted PGP message.');
      return;
    }
    if (!privText && !passphrase) {
      showStatus(status, 'error', 'Provide your Private Key (or the Symmetric Password used to encrypt).');
      return;
    }

    const btn = $('btn-decrypt');
    setLoading(btn, true, 'Decrypt Message', 'Decrypting...');
    try {
      const message = await openpgp.readMessage({ armoredMessage });
      const decOpts = { message };

      if (privText) {
        decOpts.decryptionKeys = await unlockPrivateKey(privText, passphrase);
      } else if (passphrase) {
        decOpts.passwords = [passphrase];
      }

      if (verifyPubText) {
        decOpts.verificationKeys = await readMultiplePublicKeys(verifyPubText);
      }

      const { data: decrypted, signatures } = await openpgp.decrypt(decOpts);
      $('dec-out-text').value = decrypted;

      const sigBadge = $('dec-sig-badge');
      function renderDecSigBadge(variant, title, details) {
        sigBadge.className = `verify-card ${variant}`;
        sigBadge.replaceChildren();
        const badgeEl = document.createElement('div');
        badgeEl.className = 'verify-badge';
        badgeEl.textContent = title;
        const metaEl = document.createElement('div');
        metaEl.className = 'verify-meta';
        metaEl.textContent = details;
        sigBadge.append(badgeEl, metaEl);
        sigBadge.hidden = false;
      }

      if (signatures && signatures.length > 0) {
        const sig = signatures[0];
        const keyIDHex = sig.keyID.toHex().toUpperCase();
        if (!verifyPubText) {
          renderDecSigBadge(
            'is-warn',
            'SIGNED MESSAGE (Unverified)',
            `Embedded signature from Key ID: ${keyIDHex}. Paste the sender's public key above to verify it.`
          );
        } else {
          try {
            await sig.verified;
            renderDecSigBadge(
              'is-valid',
              'VALID EMBEDDED SIGNATURE',
              `Verified signer Key ID: ${keyIDHex}`
            );
          } catch (sigErr) {
            renderDecSigBadge(
              'is-invalid',
              'INVALID EMBEDDED SIGNATURE',
              `Key ID: ${keyIDHex} | ${sigErr.message}`
            );
          }
        }
      } else {
        sigBadge.hidden = true;
      }

      outSection.hidden = false;
      showStatus(status, 'success', 'Message decrypted successfully.');
    } catch (err) {
      outSection.hidden = true;
      showStatus(status, 'error', `Decryption failed: ${err.message}`);
    } finally {
      setLoading(btn, false, 'Decrypt Message', 'Decrypting...');
    }
  });

  $('btn-dec-clear').addEventListener('click', () => {
    $('form-decrypt').reset();
    $('dec-sig-badge').hidden = true;
    $('dec-output').hidden = true;
    clearStatus($('dec-status'));
  });
})();
