param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$SecretContextPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null
  )
  $parameters = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    WebSession = $Session
    Headers = @{ Origin = $BaseUrl; Referer = "$BaseUrl/indicator" }
    SkipHttpErrorCheck = $true
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = $Body | ConvertTo-Json -Depth 100 -Compress
  }
  $response = Invoke-WebRequest @parameters
  $parsed = $null
  if ($response.Content) {
    try { $parsed = $response.Content | ConvertFrom-Json } catch { $parsed = $null }
  }
  [pscustomobject]@{
    Status = [int]$response.StatusCode
    Body = $parsed
    Headers = $response.Headers
  }
}

function Ensure-TestUser {
  param([object]$Account, [string]$InviteCode)
  $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $registration = Invoke-JsonRequest -Session $session -Method POST -Path '/api/indicator/auth/register' -Body @{
    username = $Account.username
    password = $Account.password
    inviteCode = $InviteCode
  }
  if ($registration.Status -notin @(200, 409)) {
    throw "test account registration failed with HTTP $($registration.Status)"
  }
  if ($registration.Status -eq 409) {
    $login = Invoke-JsonRequest -Session $session -Method POST -Path '/api/indicator/auth/login' -Body @{
      username = $Account.username
      password = $Account.password
    }
    if ($login.Status -ne 200) { throw "test account login failed with HTTP $($login.Status)" }
  }
  [pscustomobject]@{ Session = $session; RegistrationStatus = $registration.Status }
}

function Invoke-Case {
  param(
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [string]$CaseName,
    [string]$Address,
    [int]$TargetYear,
    [int]$OdYear,
    [string]$DestinationDirection,
    [string]$ProjectName
  )
  $search = Invoke-JsonRequest -Session $Session -Method POST -Path '/api/indicator_calculator' -Body @{
    action = 'address-search'
    address = $Address
  }
  if ($search.Status -ne 200) { throw "$CaseName address search failed with HTTP $($search.Status)" }
  $candidate = $search.Body.candidates | Where-Object { $_.candidate_id -eq $search.Body.auto_select_candidate_id } | Select-Object -First 1
  if (-not $candidate -or -not $candidate.candidate_token) { throw "$CaseName did not return an automatic exact candidate" }

  $calculation = Invoke-JsonRequest -Session $Session -Method POST -Path '/api/indicator_calculator' -Body @{
    action = 'calculate'
    address = $Address
    candidate_token = $candidate.candidate_token
    target_year = $TargetYear
    od_year = $OdYear
    access_dataset = 'auto'
  }
  if ($calculation.Status -ne 200) { throw "$CaseName calculation failed with HTTP $($calculation.Status)" }
  $before = $calculation.Body
  $row = $before.rows | Where-Object { [int]$_.taz -eq 1 } | Select-Object -First 1
  if (-not $row) { throw "$CaseName has no calculation zone row 1" }
  $beforeInflow = [double]$before.access.denominators.inflow
  $beforeOutflow = [double]$before.access.denominators.outflow
  $sourceDirection = [string]$row.current_direction

  $reassigned = Invoke-JsonRequest -Session $Session -Method POST -Path '/api/indicator_calculator' -Body @{
    action = 'reassign'
    result = $before
    changes = @{ '1' = $DestinationDirection }
  }
  if ($reassigned.Status -ne 200) { throw "$CaseName reassignment failed with HTTP $($reassigned.Status)" }
  $after = $reassigned.Body
  $afterRow = $after.rows | Where-Object { [int]$_.taz -eq 1 } | Select-Object -First 1
  $denominatorsUnchanged = ([math]::Abs($beforeInflow - [double]$after.access.denominators.inflow) -lt 1e-9) -and
    ([math]::Abs($beforeOutflow - [double]$after.access.denominators.outflow) -lt 1e-9)
  if (-not $denominatorsUnchanged -or $afterRow.current_direction -ne $DestinationDirection) {
    throw "$CaseName direction reassignment invariant failed"
  }

  $operationId = [guid]::NewGuid().ToString()
  $saveBody = @{
    operationId = $operationId
    name = $ProjectName
    calculationEnvelope = $after.storage_envelope
  }
  $saveAttempts = @()
  $firstSave = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $candidateSave = Invoke-JsonRequest -Session $Session -Method POST -Path '/api/indicator/projects' -Body $saveBody
    $saveAttempts += $candidateSave.Status
    if ($candidateSave.Status -eq 200) {
      $firstSave = $candidateSave
      break
    }
    Start-Sleep -Milliseconds 400
  }
  if ($null -eq $firstSave) { throw "$CaseName save did not recover after HTTP $($saveAttempts -join ',')" }
  $retrySave = Invoke-JsonRequest -Session $Session -Method POST -Path '/api/indicator/projects' -Body $saveBody
  if ($retrySave.Status -ne 200 -or -not $retrySave.Body.project.idempotentReplay) {
    throw "$CaseName idempotent retry was not reused"
  }

  $projectId = [string]$firstSave.Body.project.projectId
  $read = Invoke-JsonRequest -Session $Session -Method GET -Path "/api/indicator/projects?id=$projectId"
  if ($read.Status -ne 200) { throw "$CaseName saved project read failed with HTTP $($read.Status)" }
  $restoredRow = $read.Body.project.calculation.rows | Where-Object { [int]$_.taz -eq 1 } | Select-Object -First 1
  if ($restoredRow.current_direction -ne $DestinationDirection) { throw "$CaseName saved direction was not restored" }

  $publicResult = $after.PSObject.Copy()
  $publicResult.PSObject.Properties.Remove('integrity_token')
  $publicResult.PSObject.Properties.Remove('storage_envelope')
  $publicResult | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $OutputDirectory "$CaseName-result.json") -Encoding utf8

  [pscustomobject]@{
    case = $CaseName
    address_search_status = $search.Body.status
    provider_total_count = $search.Body.provider_total_count
    received_candidate_count = $search.Body.received_candidate_count
    calculation_zone_system = $after.calculation_zone.zone_system
    calculation_zone_id = $after.calculation_zone.zone_id
    calculation_zone_region = $after.calculation_zone.region_name
    location_zone_system = $after.location_zone.zone_system
    location_zone_id = $after.location_zone.zone_id
    od_year = $after.input.od_year
    target_year = $after.input.target_year
    source_direction = $sourceDirection
    destination_direction = $DestinationDirection
    denominators_unchanged = $denominatorsUnchanged
    first_save_revision = $firstSave.Body.project.revisionNumber
    save_attempt_statuses = @($saveAttempts)
    save_recovered_after_retry = $saveAttempts.Count -gt 1
    retry_idempotent_replay = [bool]$retrySave.Body.project.idempotentReplay
    restored_direction = $restoredRow.current_direction
    project_id = $projectId
    runtime_dependency = $after.runtime.computer_dependency
    runtime_bundle_version = $after.runtime.data_bundle.version
    runtime_bundle_verified = $after.runtime.data_bundle.verified
    runtime_elapsed_ms = $after.runtime.elapsed_ms
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$cipher = [IO.File]::ReadAllBytes((Resolve-Path $SecretContextPath))
$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $context = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
  if ($context.users.Count -lt 2) { throw 'two isolated test accounts are required' }

  $userA = Ensure-TestUser -Account $context.users[0] -InviteCode $context.invite_code
  $userB = Ensure-TestUser -Account $context.users[1] -InviteCode $context.invite_code
  $suwon = Invoke-Case -Session $userA.Session -CaseName 'production-suwon' -Address '경기도 수원시 팔달구 효원로 241' -TargetYear 2029 -OdYear 2023 -DestinationDirection 'east' -ProjectName '운영검증 수원 2029'
  $busan = Invoke-Case -Session $userA.Session -CaseName 'production-busan' -Address '부산광역시 연제구 중앙대로 1001' -TargetYear 2029 -OdYear 2030 -DestinationDirection 'west' -ProjectName '운영검증 부산 2029'

  $freshSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $freshLogin = Invoke-JsonRequest -Session $freshSession -Method POST -Path '/api/indicator/auth/login' -Body @{
    username = $context.users[0].username
    password = $context.users[0].password
  }
  if ($freshLogin.Status -ne 200) { throw 'fresh session login failed' }
  $freshList = Invoke-JsonRequest -Session $freshSession -Method GET -Path '/api/indicator/projects'
  if ($freshList.Status -ne 200) { throw 'fresh session project list failed' }
  $freshIds = @($freshList.Body.projects | ForEach-Object { [string]$_.projectId })
  $freshRestore = $freshIds -contains $suwon.project_id -and $freshIds -contains $busan.project_id
  if (-not $freshRestore) { throw 'fresh session did not restore both projects' }

  $crossUserRead = Invoke-JsonRequest -Session $userB.Session -Method GET -Path "/api/indicator/projects?id=$($suwon.project_id)"
  if ($crossUserRead.Status -ne 404) { throw "cross-user project access was not blocked: HTTP $($crossUserRead.Status)" }

  $summary = [ordered]@{
    status = 'PASS'
    production_url = $BaseUrl
    executed_at_utc = [DateTime]::UtcNow.ToString('o')
    test_accounts = @{ count = 2; credentials_recorded = $false }
    registration = @{ user_a_status = $userA.RegistrationStatus; user_b_status = $userB.RegistrationStatus }
    cases = @($suwon, $busan)
    fresh_login_restore = $freshRestore
    cross_user_project_read_status = $crossUserRead.Status
    secrets_in_report = $false
  }
  $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'production-http-results.json') -Encoding utf8
  Write-Output 'production HTTP verification PASS'
} finally {
  [Array]::Clear($plain, 0, $plain.Length)
}
