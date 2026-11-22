# PDF test fixture

`password-protected.pdf` is a self-generated one-page AES-256 encrypted PDF containing only “Locked PDF”. No private or copyrighted book content is included.

Test-only user password: `reader-test-only`; owner password: `owner-test-only`. These are fixture passwords, not application credentials. The test checks the fixture opens with the password before asserting password-free import is rejected.

Generated once with an already installed PyMuPDF utility. Runtime and tests need only the existing pypdfium2 dependency; PyMuPDF is not required to run them.
