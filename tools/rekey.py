#!/usr/bin/env python3
"""Troca a senha do cofre sem gravar senha em arquivo.
Execute na raiz do projeto: python tools/rekey.py
Requer: pip install cryptography
"""
from pathlib import Path
from getpass import getpass
import json, base64, secrets
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'assets' / 'vault' / 'manifest.json'

def b64d(v): return base64.b64decode(v)
def b64e(v): return base64.b64encode(v).decode('ascii')

def derive(password, salt, iterations):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode('utf-8'))

def main():
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    crypto = data['crypto']
    current = getpass('Senha atual: ')
    old_key = derive(current, b64d(crypto['salt']), int(crypto['iterations']))
    old_aes = AESGCM(old_key)
    try:
        plain = old_aes.decrypt(b64d(crypto['canaryIv']), b64d(crypto['canary']), crypto['canaryAad'].encode())
        if plain != b'MEMORIAS_FAMILIA_V2_OK': raise ValueError
    except Exception:
        raise SystemExit('Senha atual incorreta.')

    new = getpass('Nova senha: ')
    confirm = getpass('Repita a nova senha: ')
    if new != confirm: raise SystemExit('As senhas não conferem.')
    if len(new) < 14: raise SystemExit('Use pelo menos 14 caracteres.')

    new_salt = secrets.token_bytes(16)
    iterations = max(350000, int(crypto.get('iterations', 350000)))
    new_aes = AESGCM(derive(new, new_salt, iterations))

    for photo in data['photos']:
        for kind in ('original', 'thumb'):
            if kind == 'original':
                path_key, iv_key, aad_key = 'path', 'iv', 'aad'
            else:
                path_key, iv_key, aad_key = 'thumb', 'thumbIv', 'thumbAad'
            path = ROOT / photo[path_key].replace('./','')
            cipher = path.read_bytes()
            plain = old_aes.decrypt(b64d(photo[iv_key]), cipher, photo[aad_key].encode())
            new_iv = secrets.token_bytes(12)
            new_cipher = new_aes.encrypt(new_iv, plain, photo[aad_key].encode())
            path.write_bytes(new_cipher)
            photo[iv_key] = b64e(new_iv)

    canary_iv = secrets.token_bytes(12)
    canary_aad = b'memorias-v2:canary'
    canary = new_aes.encrypt(canary_iv, b'MEMORIAS_FAMILIA_V2_OK', canary_aad)
    crypto.update({
        'iterations': iterations,
        'salt': b64e(new_salt),
        'canary': b64e(canary),
        'canaryIv': b64e(canary_iv),
        'canaryAad': 'memorias-v2:canary',
    })
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Senha trocada. A nova senha não foi gravada em nenhum arquivo.')

if __name__ == '__main__': main()
