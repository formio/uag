Found <%= resultCount %> submissions for <%= form.title %> matching "<%= searchQuery %>":

<% submissions.forEach(function(submission, index) { %>
**Submission <%= index + 1 %>**
- **ID:** <%= submission._id %>
- **Requested Data:**
<% submission.data.forEach(function(field) { %>
    - <%= field.path %>: <%= field.value %>
<% }); %>
- **Partial ID (submission_id_partial):** <%= submission.partialId %>
- **Created:** <%= submission.created %>
- **Updated:** <%= submission.modified %>
<% }); %>
<% if (submissions.length > 1) { %>
**Multiple submissions found. To proceed:**
1. **Be more specific** in your search query to find just one record, OR
2. **Provide the last 4 characters** of the submission ID you want to update (shown above as "ID ends with")

Example: "Update the submission ending in **abc1**" or use `find_submission_by_field` with `submission_id_partial: "abc1"`

**Note:** All <%= fieldUpdates.length %> field update(s) will be applied to whichever submission you select.
<% } else { %>

Use the `confirm_submission_update` tool with the submission_id set to the full submission ID to submit the data.
<% } %>