$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/dictionary-text.ps1"
$root = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $root 'imports'
$topics = [ordered]@{}
$words = [ordered]@{}
$expandedCount = 0
$userCount = 0
function Key([string]$value) { ($value.Normalize().Trim() -replace '\s+', ' ').ToLowerInvariant() }

foreach ($inputFile in @('kaz-tili/merged-dictionary.json', 'user-dictionary.json')) {
    $data = Get-Content -LiteralPath (Join-Path $directory $inputFile) -Raw | ConvertFrom-Json
    if ($data.format -ne 'qazaq-words-dictionary' -or $data.version -ne 1) { throw "Неверный формат: $inputFile" }
    $declaredTopics = @{}
    foreach ($topic in $data.topics) {
        $name = Text $topic
        if (!$name) { throw "Пустой тег: $inputFile" }
        $topicKey = Key $name
        $declaredTopics[$topicKey] = $true
        if (!$topics.Contains($topicKey)) { $topics[$topicKey] = $name }
    }
    foreach ($word in $data.words) {
        $kazakh = Text $word.kazakh
        $russian = Text $word.russian
        if (!$kazakh -or !$russian) { throw "Пустое поле: $inputFile" }
        $wordTopics = @()
        foreach ($topic in $word.topics) {
            $topicKey = Key (Text $topic)
            if (!$declaredTopics.ContainsKey($topicKey)) { throw "Неизвестный тег: $topic ($inputFile)" }
            if ($wordTopics -notcontains $topics[$topicKey]) { $wordTopics += $topics[$topicKey] }
        }
        if ($inputFile -eq 'user-dictionary.json') {
            $userCount++
            if ($kazakh -match '[А-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]') {
                $kazakh = $kazakh.Replace('i', 'і').Replace('I', 'І').Replace('c', 'с').Replace('C', 'С').Replace('h', 'һ').Replace('H', 'Һ')
            }
            $kazakhVariants = @(SplitVariants $kazakh $true)
            $russianVariants = @(SplitVariants $russian)
        } else {
            $kazakhVariants = @($kazakh)
            $russianVariants = @($russian)
        }
        foreach ($kazakhVariant in $kazakhVariants) {
            foreach ($russianVariant in $russianVariants) {
                if ($kazakhVariant.Length -gt 200 -or $russianVariant.Length -gt 200) { throw 'Вариант превышает 200 символов' }
                $expandedCount++
                $pair = ConvertTo-Json -InputObject @((Key $kazakhVariant), (Key $russianVariant)) -Compress
                if (!$words.Contains($pair)) { $words[$pair] = [ordered]@{ kazakh = $kazakhVariant; russian = $russianVariant; topics = @() } }
                foreach ($topic in $wordTopics) {
                    if ($words[$pair].topics -notcontains $topic) { $words[$pair].topics += $topic }
                }
            }
        }
    }
}
$result = [ordered]@{ format = 'qazaq-words-dictionary'; version = 1; topics = @($topics.Values); words = @($words.Values) }
$target = Join-Path $directory 'general-dictionary.json'
[IO.File]::WriteAllText($target, (ConvertTo-Json -InputObject $result -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ("Сохранено {0} пар, {1} тегов. Пользовательских исходных записей: {2}. Пар после раскрытия: {3}. Совпадений объединено: {4}." -f $words.Count, $topics.Count, $userCount, $expandedCount, ($expandedCount - $words.Count))
