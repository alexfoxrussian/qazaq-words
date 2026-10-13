param([switch]$UseCache, [ValidateSet('Thematic', 'Frequent')][string]$Group = 'Thematic')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'imports/kaz-tili'
if ($Group -eq 'Frequent') { $output = Join-Path $output 'frequent' }
$cache = Join-Path $output 'source'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[void][System.IO.Directory]::CreateDirectory($cache)

. "$PSScriptRoot/dictionary-text.ps1"
function WriteJson([string]$name, $value) {
    [System.IO.File]::WriteAllText((Join-Path $output $name), (ConvertTo-Json -InputObject $value -Depth 10) + "`n", $utf8)
}
function ReadPage([string]$name) {
    $path = Join-Path $cache $name
    if ($UseCache -and (Test-Path -LiteralPath $path)) { return [System.IO.File]::ReadAllText($path, $utf8) }
    $response = Invoke-WebRequest -Uri ('https://www.kaz-tili.kz/' + $name) -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -ne 200) { throw "Ошибка загрузки $name" }
    [System.IO.File]::WriteAllText($path, $response.Content, $utf8)
    Start-Sleep -Milliseconds 400
    return $response.Content
}

$index = ReadPage 'slovar.htm'
$pattern = if ($Group -eq 'Frequent') { '(?is)<a\b[^>]*href="(slovar0[1-5]\.htm)"[^>]*>(.*?)</a>' } else { '(?is)<a\b[^>]*href="(slovar02_\d+\.htm)"[^>]*>(.*?)</a>' }
$links = [regex]::Matches($index, $pattern)
$sections = [ordered]@{}
foreach ($link in $links) {
    $sections[$link.Groups[1].Value] = Text $link.Groups[2].Value
}
$expectedSections = if ($Group -eq 'Frequent') { 5 } else { 18 }
if ($sections.Count -ne $expectedSections) { throw "Структура оглавления изменилась: найдено разделов $($sections.Count), ожидалось $expectedSections." }

$merged = [ordered]@{}
$results = @()
$issues = @()
$corrections = @()
$expansions = @()
$annotations = @()
$files = [ordered]@{}
foreach ($page in $sections.Keys) {
    $tag = $sections[$page]
    if ($tag -eq 'Cуществительные') { $tag = 'Существительные' }
    if ($tag -eq 'Овощи. Фрукты...') { $tag = 'Овощи. Фрукты. Ягоды' }
    $html = ReadPage $page
    $rows = [regex]::Matches($html, '(?is)<tr\b(?:(?!<tr\b).)*?</tr>')
    $words = [ordered]@{}
    $candidateRows = 0
    $expandedPairs = 0
    $rowNumber = 0
    foreach ($row in $rows) {
        $rowNumber++
        $cells = [regex]::Matches($row.Value, '(?is)<td\b[^>]*>(.*?)</td>')
        if ($cells.Count -lt 2) { continue }
        if ($cells[0].Value -notmatch 'class\s*=\s*["'']?kaz\b' -or $cells[1].Value -notmatch 'class\s*=\s*["'']?se\b') { continue }
        $candidateRows++
        $kazakhHtml = $cells[0].Groups[1].Value
        if ($Group -eq 'Frequent') {
            $grammar = [regex]::Match($kazakhHtml, '(?is)<span\b[^>]*class\s*=\s*["'']?(?:gl|vit|vi)\b[^>]*>.*$')
            if ($grammar.Success) {
                $annotations += [ordered]@{ source = "https://www.kaz-tili.kz/$page"; row = $rowNumber; originalKazakh = Text $kazakhHtml; annotation = Text $grammar.Value }
                $kazakhHtml = $kazakhHtml.Substring(0, $grammar.Index)
            }
        }
        $kazakh = Text $kazakhHtml
        $russian = Text $cells[1].Groups[1].Value
        $originalKazakh = $kazakh
        # Correct known mixed-script typos only, never transliterate the Latin column.
        if ($kazakh -match '[А-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]') {
            $kazakh = $kazakh.Replace('i', 'і').Replace('I', 'І').Replace('c', 'с').Replace('C', 'С').Replace('h', 'һ').Replace('H', 'Һ')
        }
        if ($kazakh -cne $originalKazakh) {
            $corrections += [ordered]@{ source = "https://www.kaz-tili.kz/$page"; row = $rowNumber; originalKazakh = $originalKazakh; kazakh = $kazakh; russian = $russian }
        }
        if (!$kazakh -or !$russian) { throw "Пустое поле: $page, строка $rowNumber" }
        $entry = [ordered]@{ kazakh = $kazakh; russian = $russian; topics = @($tag) }
        $kazakhVariants = @(if ($Group -eq 'Frequent' -and $page -eq 'slovar05.htm') { SharedSlashVariants $kazakh } else { SplitVariants $kazakh $true })
        $russianVariants = @(SplitVariants $russian)
        $reasons = @()
        if ($kazakh -match '[a-zA-Z]') { $reasons += 'Латинские буквы в казахском поле' }
        if ($russian -match '\d\)') { $reasons += 'Нумерованные значения: требуется отдельный разбор' }
        if ($kazakh -match '&\w+' -or $russian -match '&\w+') { $reasons += 'Остаток HTML-сущности в тексте' }
        if (@($kazakhVariants | Where-Object { $_.Length -gt 200 }).Count -or @($russianVariants | Where-Object { $_.Length -gt 200 }).Count) { $reasons += 'Превышен лимит 200 символов; длинный вариант исключён из импорта' }
        if ($reasons.Count) { $issues += [ordered]@{ source = "https://www.kaz-tili.kz/$page"; row = $rowNumber; entry = $entry; reasons = $reasons } }
        if ($kazakhVariants.Count -gt 1 -or $russianVariants.Count -gt 1) {
            $expansions += [ordered]@{ source = "https://www.kaz-tili.kz/$page"; row = $rowNumber; entry = $entry; kazakhVariants = $kazakhVariants; russianVariants = $russianVariants; pairs = $kazakhVariants.Count * $russianVariants.Count }
        }
        foreach ($kazakhVariant in $kazakhVariants) {
            foreach ($russianVariant in $russianVariants) {
                if ($kazakhVariant.Length -gt 200 -or $russianVariant.Length -gt 200) { continue }
                $expandedPairs++
                $key = ConvertTo-Json -InputObject @($kazakhVariant.ToLowerInvariant(), $russianVariant.ToLowerInvariant()) -Compress
                if (!$words.Contains($key)) { $words[$key] = [ordered]@{ kazakh = $kazakhVariant; russian = $russianVariant; topics = @($tag) } }
                if ($merged.Contains($key)) {
                    if ($merged[$key].topics -notcontains $tag) { $merged[$key].topics += $tag }
                } else {
                    $merged[$key] = [ordered]@{ kazakh = $kazakhVariant; russian = $russianVariant; topics = @($tag) }
                }
            }
        }
    }
    if (!$words.Count) { throw "В разделе $page не найдено записей; требуется проверка разметки." }
    $numberPattern = if ($Group -eq 'Frequent') { 'slovar0([1-5])' } else { '_(\d+)' }
    $number = [int]([regex]::Match($page, $numberPattern).Groups[1].Value)
    $file = '{0:d2}.json' -f $number
    $files[$file] = [ordered]@{ format = 'qazaq-words-dictionary'; version = 1; topics = @($tag); words = @($words.Values) }
    $results += [ordered]@{ tag = $tag; url = "https://www.kaz-tili.kz/$page"; file = $file; sourceRows = $candidateRows; expandedPairs = $expandedPairs; words = $words.Count; duplicates = $expandedPairs - $words.Count }
    Write-Output ("{0}: {1} записей" -f $tag, $words.Count)
}

foreach ($file in $files.Keys) { WriteJson $file $files[$file] }
WriteJson 'dictionary.json' ([ordered]@{ format = 'qazaq-words-dictionary'; version = 1; topics = @($results | ForEach-Object { $_.tag }); words = @($merged.Values) })
WriteJson 'review.json' $issues
WriteJson 'corrections.json' $corrections
WriteJson 'expansions.json' $expansions
if ($Group -eq 'Frequent') { WriteJson 'annotations.json' $annotations }
$fetchedAt = @($sections.Keys | ForEach-Object { [System.IO.File]::GetLastWriteTimeUtc((Join-Path $cache $_)) } | Sort-Object)[-1].ToString('o')
WriteJson 'manifest.json' ([ordered]@{ fetchedAt = $fetchedAt; author = 'Татьяна Валяева'; source = 'https://www.kaz-tili.kz/slovar.htm'; terms = 'https://www.kaz-tili.kz/osaite.htm'; sections = $results; uniquePairs = $merged.Count; reviewEntries = $issues.Count; correctedEntries = $corrections.Count })
Write-Output ("Итого: {0} тегов, {1} уникальных пар, {2} строк для проверки." -f $results.Count, $merged.Count, $issues.Count)
