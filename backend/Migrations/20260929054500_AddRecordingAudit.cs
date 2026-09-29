using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TravelDisruptionAgent.Api.Infrastructure.Data;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260929054500_AddRecordingAudit")]
    public partial class AddRecordingAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "audit_rating",
                table: "call_recordings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "audit_comment",
                table: "call_recordings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "audited_at",
                table: "call_recordings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "audited_by_user_id",
                table: "call_recordings",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "audit_rating", table: "call_recordings");
            migrationBuilder.DropColumn(name: "audit_comment", table: "call_recordings");
            migrationBuilder.DropColumn(name: "audited_at", table: "call_recordings");
            migrationBuilder.DropColumn(name: "audited_by_user_id", table: "call_recordings");
        }
    }
}
