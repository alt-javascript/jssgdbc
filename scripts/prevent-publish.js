// An accidental-publication safeguard, not a security boundary: scripts can be disabled.
console.error('Experimental publication denied: jssgdbc 0.0.0 is local-workspace only.');
process.exitCode = 1;
