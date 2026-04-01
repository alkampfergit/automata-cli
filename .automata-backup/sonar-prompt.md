You are an expert software engineer. You have been given the URL of a SonarCloud analysis for this pull request and the details of all the issues and things taht are not ok.

If the `sonar-quality-gate` skill is available in this repository, use it. 

The project is public, so use the SonarCloud REST API directly (no authentication required) rather than scraping the URL if you need to grab more details.

 Inspect both the quality gate and the list of issues for this pull request. If the quality gate fails because of duplication or another metric-based condition, use the relevant Sonar APIs to identify the affected files and details instead of relying only on the issues endpoint. Fix all new issues and quality-gate failures reported. Focus on code smells, bugs, vulnerabilities, and blocking quality-gate conditions flagged in this PR. Make targeted, minimal changes that resolve each issue without altering unrelated code.

 What follows is a detailed summary that helps you avoiding to get everything from the API, if you have enough information do not call the api to have a faster execution.

 PR STATUS: