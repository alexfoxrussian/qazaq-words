function Text([string]$html) {
    $decoded = [System.Net.WebUtility]::HtmlDecode([regex]::Replace($html, '<[^>]+>', ' '))
    # Some source rows contain &nbsp without its terminating semicolon.
    $decoded = [regex]::Replace($decoded, '&nbsp;?', ' ')
    $decoded.Normalize().Trim() -replace '\s+', ' '
}
function SplitVariants([string]$value, [bool]$kazakhField = $false) {
    # Kazakh trailing parentheses contain alternative headwords in these sections.
    # Russian parentheses contain explanations and stay attached to the translation.
    if ($kazakhField -and $value -match '^([^()]+?)\s*\(([^()]+)\)\s*$') {
        $value = $Matches[1].Trim() + ';' + $Matches[2].Trim()
    }
    $depth = 0
    $start = 0
    $variants = [ordered]@{}
    for ($index = 0; $index -le $value.Length; $index++) {
        if ($index -lt $value.Length) {
            $character = $value[$index]
            if ($character -eq '(' -or $character -eq '[') { $depth++ }
            if ($character -eq ')' -or $character -eq ']') { $depth-- }
            if ($depth -lt 0) { throw "Несбалансированные скобки: $value" }
        }
        if ($index -eq $value.Length -or ($depth -eq 0 -and ',;/'.Contains([string]$value[$index]))) {
            $part = $value.Substring($start, $index - $start).Trim()
            # Slashes may surround an additional translation: /осторожно/.
            if ($part) { $variants[$part.ToLowerInvariant()] = $part }
            $start = $index + 1
        }
    }
    if ($depth -ne 0) { throw "Несбалансированные скобки: $value" }
    if (!$variants.Count) { throw "Нет вариантов: $value" }
    @($variants.Values)
}
function SharedSlashVariants([string]$value) {
    $values = @($value)
    do {
        $changed = $false
        $next = @()
        foreach ($item in $values) {
            $match = [regex]::Match($item, '[^\s,/;()]+(?:/[^\s,/;()]+)+')
            if (!$match.Success) { $next += $item; continue }
            $changed = $true
            foreach ($alternative in $match.Value.Split('/')) {
                $next += $item.Substring(0, $match.Index) + $alternative + $item.Substring($match.Index + $match.Length)
            }
        }
        $values = $next
    } while ($changed)
    foreach ($item in $values) { SplitVariants $item $true }
}
